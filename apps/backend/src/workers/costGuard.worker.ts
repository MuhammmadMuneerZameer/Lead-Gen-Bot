/**
 * CostGuard worker — polls daily AI spend every 10 minutes.
 * If spend >= 80% of budget, pauses the enrichmentQueue (AI-heavy).
 * If spend >= 100%, also pauses scoringQueue.
 *
 * This is a RepeatableJob — registered as a scheduled task, not a
 * queue-driven worker. We export a thin Worker wrapper so startWorkers()
 * can register its error listeners uniformly.
 */

import { Worker, Job, Queue } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { getDailySpend } from '../ai/guardedAICall';
import { enrichmentQueue, scoringQueue } from '../lib/queues';

const DAILY_BUDGET = parseFloat(process.env.AI_DAILY_BUDGET_USD ?? '5');
const WARN_THRESHOLD = 0.8; // pause enrichment at 80%
const HARD_THRESHOLD = 1.0; // pause scoring at 100%

const GUARD_QUEUE = new Queue('cost-guard', { connection: redis });

// Register the repeatable job — runs every 10 minutes
GUARD_QUEUE.add(
  'check',
  {},
  {
    repeat: { every: 10 * 60 * 1000 },
    removeOnComplete: { count: 5 },
  },
).catch(() => {
  // Safe to ignore — job already registered on subsequent starts
});

export const costGuardWorker = new Worker(
  'cost-guard',
  async (_job: Job) => {
    const spent = await getDailySpend();
    const ratio = spent / DAILY_BUDGET;

    logger.debug('CostGuard check', {
      spent: spent.toFixed(4),
      budget: DAILY_BUDGET,
      ratio: ratio.toFixed(2),
    });

    if (ratio >= HARD_THRESHOLD) {
      await enrichmentQueue.pause();
      await scoringQueue.pause();
      logger.warn('CostGuard: HARD limit reached — enrichment + scoring queues paused', {
        spent,
        budget: DAILY_BUDGET,
      });
      return { action: 'hard_pause', spent };
    }

    if (ratio >= WARN_THRESHOLD) {
      await enrichmentQueue.pause();
      logger.warn('CostGuard: WARN threshold reached — enrichment queue paused', {
        spent,
        budget: DAILY_BUDGET,
      });
      return { action: 'warn_pause', spent };
    }

    // Below threshold — ensure queues are resumed if previously paused
    const [enrichPaused, scorePaused] = await Promise.all([
      enrichmentQueue.isPaused(),
      scoringQueue.isPaused(),
    ]);

    if (enrichPaused) {
      await enrichmentQueue.resume();
      logger.info('CostGuard: enrichment queue resumed (budget recovered)');
    }
    if (scorePaused) {
      await scoringQueue.resume();
      logger.info('CostGuard: scoring queue resumed (budget recovered)');
    }

    return { action: 'ok', spent };
  },
  { connection: redis, concurrency: 1 },
);
