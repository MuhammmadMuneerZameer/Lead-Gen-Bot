/**
 * Outreach router — manage outreach logs, send messages, track replies.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { OutreachLog } from '../../models/outreach.model';
import { Lead } from '../../models/lead.model';
import { logger } from '../../lib/logger';

const router = Router();

const CreateOutreachSchema = z.object({
  leadId: z.string().min(1),
  channel: z.enum(['email', 'linkedin', 'whatsapp', 'instagram']),
  messageSent: z.string().min(1).max(10000),
  promptTemplateId: z.string().optional(),
  followUpDate: z.string().datetime().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['pending', 'sent', 'opened', 'replied', 'bounced', 'failed', 'ignored']),
  response: z.string().max(5000).optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'sent', 'opened', 'replied', 'bounced', 'failed', 'ignored']).optional(),
  channel: z.enum(['email', 'linkedin', 'whatsapp', 'instagram']).optional(),
  leadId: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// ── GET /api/outreach ────────────────────────────────────────────────────────

router.get('/', authenticate, validate(ListQuerySchema, 'query'), async (req: Request, res: Response) => {
  try {
    const q = req.query as unknown as z.infer<typeof ListQuerySchema>;
    const { page, limit, status, channel, leadId, sortDir } = q;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (channel) filter.channel = channel;
    if (leadId && mongoose.isValidObjectId(leadId)) filter.leadId = new mongoose.Types.ObjectId(leadId);

    const skip = (page - 1) * limit;
    const sort = { sentAt: sortDir === 'asc' ? 1 : -1 } as const;

    const [data, total] = await Promise.all([
      OutreachLog.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('leadId', 'businessName domain priority score')
        .lean(),
      OutreachLog.countDocuments(filter),
    ]);

    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.error('GET /outreach error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/outreach/pending-followups ──────────────────────────────────────

router.get('/pending-followups', authenticate, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const data = await OutreachLog.find({
      followUpDate: { $lte: now },
      status: { $in: ['sent', 'opened'] },
    })
      .sort({ followUpDate: 1 })
      .limit(50)
      .populate('leadId', 'businessName domain priority score')
      .lean();

    res.json({ data, count: data.length });
  } catch (err) {
    logger.error('GET /outreach/pending-followups error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/outreach/:id ────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'INVALID_ID' });
      return;
    }
    const log = await OutreachLog.findById(id)
      .populate('leadId', 'businessName domain priority score status')
      .lean();
    if (!log) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ outreach: log });
  } catch (err) {
    logger.error('GET /outreach/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/outreach ───────────────────────────────────────────────────────

router.post('/', authenticate, validate(CreateOutreachSchema), async (req: Request, res: Response) => {
  try {
    const body = req.body as z.infer<typeof CreateOutreachSchema>;

    if (!mongoose.isValidObjectId(body.leadId)) {
      res.status(400).json({ error: 'INVALID_LEAD_ID' });
      return;
    }

    const lead = await Lead.findById(body.leadId).lean();
    if (!lead) {
      res.status(404).json({ error: 'LEAD_NOT_FOUND' });
      return;
    }

    const log = await OutreachLog.create({
      leadId: body.leadId,
      channel: body.channel,
      messageSent: body.messageSent,
      promptTemplateId: body.promptTemplateId,
      followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined,
      status: 'pending',
    });

    await Lead.findByIdAndUpdate(body.leadId, { status: 'contacted' });

    res.status(201).json({ outreach: log });
  } catch (err) {
    logger.error('POST /outreach error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/outreach/:id/status ───────────────────────────────────────────

router.patch('/:id/status', authenticate, validate(UpdateStatusSchema), async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'INVALID_ID' });
      return;
    }

    const body = req.body as z.infer<typeof UpdateStatusSchema>;
    const now = new Date();

    const update: Record<string, unknown> = { status: body.status };
    if (body.status === 'sent') update.sentAt = now;
    if (body.status === 'opened') update.openedAt = now;
    if (body.status === 'replied') { update.repliedAt = now; update.response = body.response; }

    const log = await OutreachLog.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!log) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    if (body.status === 'replied' && log.leadId) {
      await Lead.findByIdAndUpdate(log.leadId, { status: 'replied' });
    }

    res.json({ outreach: log });
  } catch (err) {
    logger.error('PATCH /outreach/:id/status error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── DELETE /api/outreach/:id ─────────────────────────────────────────────────

router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ error: 'INVALID_ID' });
      return;
    }
    await OutreachLog.findByIdAndDelete(id);
    res.status(204).send();
  } catch (err) {
    logger.error('DELETE /outreach/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
