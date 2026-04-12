/**
 * Settings router — scoring config and prompt template management.
 * These are the two core "living" tables in HydraFox's self-improvement loop.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { ScoringConfig } from '../../models/scoringConfig.model';
import { PromptTemplate } from '../../models/promptTemplate.model';
import { bustScoringCache } from '../../scoring/score.engine';
import { logger } from '../../lib/logger';

const router = Router();

// ════════════════════════════════════════════════════════════════════════════
// SCORING CONFIG
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/settings/scoring — list all versions ───────────────────────────

router.get('/scoring', authenticate, async (_req: Request, res: Response) => {
  try {
    const configs = await ScoringConfig.find().sort({ version: -1 }).limit(20).lean();
    res.json({ data: configs });
  } catch (err) {
    logger.error('GET /settings/scoring error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/settings/scoring/active — active config ────────────────────────

router.get('/scoring/active', authenticate, async (_req: Request, res: Response) => {
  try {
    const config = await ScoringConfig.findOne({ active: true }).lean();
    if (!config) {
      res.status(404).json({ error: 'NO_ACTIVE_CONFIG', message: 'Run npm run seed first' });
      return;
    }
    res.json(config);
  } catch (err) {
    logger.error('GET /settings/scoring/active error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

const WeightsUpdateSchema = z.object({
  weights: z.record(z.string(), z.number()),
  reason: z.string().min(1).max(500).optional(),
});

// ── POST /api/settings/scoring — create new config version (manual override) ─

router.post('/scoring', authenticate, validate(WeightsUpdateSchema), async (req: Request, res: Response) => {
  try {
    const { weights, reason } = req.body as z.infer<typeof WeightsUpdateSchema>;

    const current = await ScoringConfig.findOne({ active: true }).lean();
    if (!current) {
      res.status(404).json({ error: 'NO_ACTIVE_CONFIG' });
      return;
    }

    // Build change log comparing new weights to current
    const changeLog = Object.entries(weights)
      .filter(([k, v]) => current.weights[k] !== v)
      .map(([k, v]) => ({
        factor: k,
        oldWeight: current.weights[k] ?? 0,
        newWeight: v,
        reason: reason ?? 'manual override',
      }));

    if (changeLog.length === 0) {
      res.status(400).json({ error: 'NO_CHANGES', message: 'New weights are identical to current' });
      return;
    }

    const config = new ScoringConfig({
      weights: { ...current.weights, ...weights },
      industryTiers: current.industryTiers,
      generatedBy: 'manual',
      changeLog,
      active: true,
    });
    await config.save();
    await bustScoringCache();

    logger.info('ScoringConfig updated manually', { version: config.version, changes: changeLog.length });
    res.status(201).json(config);
  } catch (err) {
    logger.error('POST /settings/scoring error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/settings/scoring/:id/activate — rollback to older version ─────

router.post('/scoring/:id/activate', authenticate, async (req: Request, res: Response) => {
  try {
    const config = await ScoringConfig.findById(req.params.id);
    if (!config) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    config.active = true;
    await config.save(); // pre-save hook deactivates all others
    await bustScoringCache();

    logger.info('ScoringConfig rolled back', { version: config.version });
    res.json({ activated: true, version: config.version });
  } catch (err) {
    logger.error('POST /settings/scoring/:id/activate error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROMPT TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/settings/prompts — list all active templates ───────────────────

router.get('/prompts', authenticate, async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const status = (req.query.status as string) ?? 'active';

    const filter: Record<string, unknown> = { status };
    if (type) filter.type = type;

    const templates = await PromptTemplate.find(filter)
      .sort({ replyRate: -1, version: -1 })
      .lean();

    res.json({ data: templates });
  } catch (err) {
    logger.error('GET /settings/prompts error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/settings/prompts/:id ────────────────────────────────────────────

router.get('/prompts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const template = await PromptTemplate.findById(req.params.id).lean();
    if (!template) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json(template);
  } catch (err) {
    logger.error('GET /settings/prompts/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

const PromptCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['analysis', 'outreach_email', 'outreach_linkedin', 'batch_analysis']),
  template: z.string().min(10),
  targetIndustry: z.string().optional(),
  targetService: z.string().optional(),
});

const PromptUpdateSchema = z.object({
  template: z.string().min(10),
  targetIndustry: z.string().optional(),
  reason: z.string().optional(),
});

// ── POST /api/settings/prompts — create new template ────────────────────────

router.post('/prompts', authenticate, validate(PromptCreateSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof PromptCreateSchema>;

    // Auto-increment version for same name
    const latest = await PromptTemplate.findOne({ name: body.name }).sort({ version: -1 }).lean();
    const version = latest ? latest.version + 1 : 1;

    // Retire previous version of same name
    if (latest) {
      await PromptTemplate.updateMany({ name: body.name, status: 'active' }, { status: 'retired', retiredAt: new Date() });
    }

    const template = await PromptTemplate.create({
      ...body,
      version,
      status: 'active',
      generatedBy: 'system',
    });

    res.status(201).json(template);
  } catch (err) {
    logger.error('POST /settings/prompts error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/settings/prompts/:id — update template text (creates new version) ──

router.patch('/prompts/:id', authenticate, validate(PromptUpdateSchema), async (req: Request, res: Response) => {
  try {
    const existing = await PromptTemplate.findById(req.params.id).lean();
    if (!existing) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const body = req.body as z.infer<typeof PromptUpdateSchema>;

    // Retire current
    await PromptTemplate.findByIdAndUpdate(req.params.id, { status: 'retired', retiredAt: new Date() });

    // Create new version
    const updated = await PromptTemplate.create({
      name: existing.name,
      type: existing.type,
      template: body.template,
      targetIndustry: body.targetIndustry ?? existing.targetIndustry,
      version: existing.version + 1,
      status: 'active',
      generatedBy: 'system',
      parentVersion: existing.version,
    });

    res.status(201).json(updated);
  } catch (err) {
    logger.error('PATCH /settings/prompts/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── DELETE /api/settings/prompts/:id — retire a template ────────────────────

router.delete('/prompts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const template = await PromptTemplate.findByIdAndUpdate(
      req.params.id,
      { status: 'retired', retiredAt: new Date() },
      { new: true },
    ).lean();
    if (!template) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ retired: true });
  } catch (err) {
    logger.error('DELETE /settings/prompts/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
