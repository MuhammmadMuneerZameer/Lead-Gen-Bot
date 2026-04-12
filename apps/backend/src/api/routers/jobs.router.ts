/**
 * Jobs router — BullMQ queue monitoring and control.
 * Exposes queue stats, recent job lists, and pause/resume controls.
 */
import { Router, Request, Response } from 'express';
import { Queue, JobType } from 'bullmq';
import { authenticate } from '../../middleware/auth.middleware';
import {
  scrapingQueue,
  enrichmentQueue,
  scoringQueue,
  feedbackQueue,
  optimizerQueue,
  getQueueStats,
} from '../../lib/queues';
import { logger } from '../../lib/logger';

const router = Router();

const QUEUES: Record<string, Queue> = {
  scraping: scrapingQueue,
  enrichment: enrichmentQueue,
  scoring: scoringQueue,
  feedback: feedbackQueue,
  optimizer: optimizerQueue,
};

/** Extract a single string from req.params (which is typed as string | string[]) */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : (v ?? '');
}

// ── GET /api/jobs — all queue counts at a glance ────────────────────────────

router.get('/', authenticate, async (_req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();

    const pausedStates = await Promise.all(
      Object.entries(QUEUES).map(async ([name, q]) => ({
        name,
        paused: await q.isPaused(),
      })),
    );
    const paused = Object.fromEntries(pausedStates.map(({ name, paused }) => [name, paused]));

    res.json({ stats, paused });
  } catch (err) {
    logger.error('GET /jobs error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/jobs/:queue/jobs — list recent jobs from a specific queue ───────

router.get('/:queue/jobs', authenticate, async (req: Request, res: Response) => {
  try {
    const queueName = param(req, 'queue');
    const q = QUEUES[queueName];
    if (!q) {
      res.status(404).json({ error: 'QUEUE_NOT_FOUND', queues: Object.keys(QUEUES) });
      return;
    }

    const type = (req.query.type as string) ?? 'active';
    const validTypes: JobType[] = ['active', 'waiting', 'completed', 'failed', 'delayed'];
    if (!validTypes.includes(type as JobType)) {
      res.status(400).json({ error: 'INVALID_TYPE', valid: validTypes });
      return;
    }

    const start = parseInt(String(req.query.start ?? '0'), 10);
    const end = Math.min(parseInt(String(req.query.end ?? '19'), 10), 99);

    const jobs = await q.getJobs([type as JobType], start, end, true);
    const formatted = jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: (job as { failedReason?: string }).failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      timestamp: job.timestamp,
    }));

    res.json({ queue: queueName, type, jobs: formatted });
  } catch (err) {
    logger.error('GET /jobs/:queue/jobs error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/jobs/:queue/pause ──────────────────────────────────────────────

router.post('/:queue/pause', authenticate, async (req: Request, res: Response) => {
  try {
    const queueName = param(req, 'queue');
    const q = QUEUES[queueName];
    if (!q) {
      res.status(404).json({ error: 'QUEUE_NOT_FOUND' });
      return;
    }
    await q.pause();
    logger.info(`Queue "${queueName}" paused`, { by: req.user?.userId });
    res.json({ queue: queueName, paused: true });
  } catch (err) {
    logger.error('POST /jobs/:queue/pause error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/jobs/:queue/resume ─────────────────────────────────────────────

router.post('/:queue/resume', authenticate, async (req: Request, res: Response) => {
  try {
    const queueName = param(req, 'queue');
    const q = QUEUES[queueName];
    if (!q) {
      res.status(404).json({ error: 'QUEUE_NOT_FOUND' });
      return;
    }
    await q.resume();
    logger.info(`Queue "${queueName}" resumed`, { by: req.user?.userId });
    res.json({ queue: queueName, paused: false });
  } catch (err) {
    logger.error('POST /jobs/:queue/resume error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/jobs/:queue/drain — remove all waiting jobs ───────────────────

router.post('/:queue/drain', authenticate, async (req: Request, res: Response) => {
  try {
    const queueName = param(req, 'queue');
    const q = QUEUES[queueName];
    if (!q) {
      res.status(404).json({ error: 'QUEUE_NOT_FOUND' });
      return;
    }
    await q.drain();
    logger.warn(`Queue "${queueName}" drained`, { by: req.user?.userId });
    res.json({ queue: queueName, drained: true });
  } catch (err) {
    logger.error('POST /jobs/:queue/drain error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/jobs/scrape — manually enqueue a scrape job ───────────────────

router.post('/scrape', authenticate, async (req: Request, res: Response) => {
  try {
    const { source = 'gmaps', query, location, maxResults = 20 } = req.body as {
      source?: string;
      query: string;
      location?: string;
      maxResults?: number;
    };

    if (!query) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'query is required' });
      return;
    }

    const job = await scrapingQueue.add('scrape', { source, query, location, maxResults });
    logger.info('Manual scrape job enqueued', { jobId: job.id, source, query });
    res.status(202).json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    logger.error('POST /jobs/scrape error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/jobs/enrich/:leadId — manually trigger enrichment for a lead ──

router.post('/enrich/:leadId', authenticate, async (req: Request, res: Response) => {
  try {
    const leadId = param(req, 'leadId');
    const job = await enrichmentQueue.add('enrich', {
      leadId,
      domain: req.body.domain ?? '',
      website: req.body.website,
    });
    logger.info('Manual enrichment job enqueued', { jobId: job.id, leadId });
    res.status(202).json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    logger.error('POST /jobs/enrich/:leadId error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
