import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { Campaign } from '../../models/campaign.model';
import { OutreachLog } from '../../models/outreach.model';
import { logger } from '../../lib/logger';

const router = Router();

const CampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  channel: z.enum(['email', 'linkedin', 'whatsapp', 'instagram']),
  targetIndustries: z.array(z.string()).default([]),
  targetPriorities: z.array(z.enum(['hot', 'warm', 'cold'])).default(['hot', 'warm']),
  promptTemplateId: z.string().optional(),
  dailyLimit: z.number().int().min(1).max(500).default(20),
});

const StatusUpdateSchema = z.object({
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']),
});

// ── GET /api/campaigns ────────────────────────────────────────────────────────

router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const campaigns = await Campaign.find(filter)
      .sort({ createdAt: -1 })
      .populate('promptTemplateId', 'name type version')
      .lean();

    res.json({ data: campaigns });
  } catch (err) {
    logger.error('GET /campaigns error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/campaigns/:id ────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate('promptTemplateId', 'name type version template')
      .lean();

    if (!campaign) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    // Outreach stats for this campaign's leads
    const recentOutreach = await OutreachLog.find({ status: { $in: ['sent', 'opened', 'replied'] } })
      .sort({ sentAt: -1 })
      .limit(10)
      .lean();

    res.json({ campaign, recentOutreach });
  } catch (err) {
    logger.error('GET /campaigns/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/campaigns ───────────────────────────────────────────────────────

router.post('/', authenticate, validate(CampaignSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof CampaignSchema>;
    const campaign = await Campaign.create({ ...body, createdBy: req.user!.userId });
    res.status(201).json(campaign);
  } catch (err) {
    logger.error('POST /campaigns error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/campaigns/:id ──────────────────────────────────────────────────

router.patch('/:id', authenticate, validate(CampaignSchema.partial()), async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!campaign) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json(campaign);
  } catch (err) {
    logger.error('PATCH /campaigns/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/campaigns/:id/status ──────────────────────────────────────────

router.patch('/:id/status', authenticate, validate(StatusUpdateSchema), async (req: Request, res: Response) => {
  try {
    const { status } = req.body as z.infer<typeof StatusUpdateSchema>;
    const update: Record<string, unknown> = { status };
    if (status === 'active') update.startedAt = new Date();
    if (status === 'completed') update.completedAt = new Date();

    const campaign = await Campaign.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!campaign) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json(campaign);
  } catch (err) {
    logger.error('PATCH /campaigns/:id/status error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── DELETE /api/campaigns/:id — archive ──────────────────────────────────────

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status: 'archived' },
      { new: true },
    ).lean();
    if (!campaign) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ archived: true });
  } catch (err) {
    logger.error('DELETE /campaigns/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
