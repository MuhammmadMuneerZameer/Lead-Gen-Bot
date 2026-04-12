import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { Lead } from '../../models/lead.model';
import { Enrichment } from '../../models/enrichment.model';
import { OutcomeLog } from '../../models/outcomeLog.model';
import { mergeOrCreate } from '../../utils/dedup';
import { scoreLeadFromDB } from '../../scoring/score.engine';
import { logger } from '../../lib/logger';

const router = Router();

// ── Validation schemas ──────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  priority: z.enum(['hot', 'warm', 'cold']).optional(),
  status: z
    .enum(['new', 'enriched', 'reviewed', 'contacted', 'won', 'lost', 'archived'])
    .optional(),
  industry: z.string().optional(),
  source: z.enum(['gmaps', 'linkedin', 'instagram', 'manual']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['score', 'createdAt', 'enrichedAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

const ManualLeadSchema = z.object({
  businessName: z.string().min(1).max(200),
  domain: z.string().min(1).max(200),
  website: z.string().url().optional(),
  industry: z.string().max(100).optional(),
  location: z
    .object({
      city: z.string().max(100).optional(),
      country: z.string().length(2).optional(),
    })
    .optional(),
});

const StatusUpdateSchema = z.object({
  status: z.enum(['new', 'enriched', 'reviewed', 'contacted', 'won', 'lost', 'archived']),
});

const OutcomeSchema = z.object({
  actualOutcome: z.enum(['replied', 'interested', 'converted', 'ignored', 'bounced', 'objected']),
  replyQuality: z.enum(['positive', 'neutral', 'negative', 'none']).default('none'),
  dealValue: z.number().positive().optional(),
  daysToReply: z.number().int().min(0).optional(),
  channelUsed: z.string().min(1),
  pitchAngle: z.string().optional(),
  promptTemplateId: z.string().optional(),
});

// ── GET /api/leads ──────────────────────────────────────────────────────────

router.get('/', authenticate, validate(ListQuerySchema, 'query'), async (req: Request, res: Response) => {
  try {
    const q = req.query as unknown as z.infer<typeof ListQuerySchema>;
    const { page, limit, priority, status, industry, source, search, sortBy, sortDir } = q;

    const filter: Record<string, unknown> = {};
    if (priority) filter.priority = priority;
    if (status) filter.status = status;
    if (industry) filter.industry = new RegExp(industry, 'i');
    if (source) filter.source = source;
    if (search) {
      filter.$or = [
        { businessName: new RegExp(search, 'i') },
        { domain: new RegExp(search, 'i') },
      ];
    }

    const sort: Record<string, 1 | -1> = { [sortBy]: sortDir === 'asc' ? 1 : -1 };
    const skip = (page - 1) * limit;

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Lead.countDocuments(filter),
    ]);

    res.json({
      data: leads,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('GET /leads error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/leads/:id ──────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const enrichment = await Enrichment.findOne({ leadId: lead._id }).lean();
    res.json({ lead, enrichment: enrichment ?? null });
  } catch (err) {
    logger.error('GET /leads/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/leads — manual lead creation ──────────────────────────────────

router.post('/', authenticate, validate(ManualLeadSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof ManualLeadSchema>;
    const { lead, isNew } = await mergeOrCreate(
      { domain: body.domain, businessName: body.businessName, source: 'manual' },
      { website: body.website, industry: body.industry, location: body.location },
    );
    res.status(isNew ? 201 : 200).json({ lead, isNew });
  } catch (err) {
    logger.error('POST /leads error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/leads/:id/status ─────────────────────────────────────────────

router.patch('/:id/status', authenticate, validate(StatusUpdateSchema), async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { status: (req.body as z.infer<typeof StatusUpdateSchema>).status },
      { new: true },
    ).lean();
    if (!lead) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ lead });
  } catch (err) {
    logger.error('PATCH /leads/:id/status error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/leads/:id/outcome — one-click outcome logging ─────────────────

router.post('/:id/outcome', authenticate, validate(OutcomeSchema), async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const body = req.body as z.infer<typeof OutcomeSchema>;

    const outcomeLog = await OutcomeLog.create({
      leadId: lead._id,
      predictedScore: lead.score,
      predictedPriority: lead.priority,
      actualOutcome: body.actualOutcome,
      replyQuality: body.replyQuality,
      dealValue: body.dealValue,
      daysToReply: body.daysToReply,
      channelUsed: body.channelUsed,
      pitchAngle: body.pitchAngle,
      scoreFactors: lead.scoreBreakdown ?? {},
      industryTier: lead.industryTier,
      promptTemplateId: body.promptTemplateId,
      loggedAt: new Date(),
    });

    const statusMap: Record<string, string> = {
      replied: 'contacted',
      interested: 'contacted',
      converted: 'won',
      bounced: 'archived',
    };
    const newStatus = statusMap[body.actualOutcome];
    if (newStatus) {
      await Lead.findByIdAndUpdate(lead._id, { status: newStatus });
    }

    res.status(201).json({ outcomeLog });
  } catch (err) {
    logger.error('POST /leads/:id/outcome error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/leads/:id/rescore ─────────────────────────────────────────────

router.post('/:id/rescore', authenticate, async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const enrichment = await Enrichment.findOne({ leadId: lead._id }).lean();
    if (!enrichment) {
      res.status(422).json({ error: 'NOT_ENRICHED', message: 'Lead must be enriched before rescoring' });
      return;
    }

    const result = await scoreLeadFromDB({
      industry: lead.industry,
      industryTier: lead.industryTier,
      enrichment,
    });

    lead.score = result.score;
    lead.priority = result.priority;
    lead.scoreBreakdown = result.scoreBreakdown;
    lead.scoringConfigVersion = result.configVersion;
    await lead.save();

    res.json({ score: result.score, priority: result.priority, scoreBreakdown: result.scoreBreakdown });
  } catch (err) {
    logger.error('POST /leads/:id/rescore error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── DELETE /api/leads/:id — soft-delete (archive) ──────────────────────────

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { status: 'archived' },
      { new: true },
    ).lean();
    if (!lead) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ archived: true });
  } catch (err) {
    logger.error('DELETE /leads/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
