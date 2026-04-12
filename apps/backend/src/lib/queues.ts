import { Queue, QueueEvents } from 'bullmq';
import { redis } from './redis';
import { logger } from './logger';

const CONNECTION = redis;

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 200 },
};

// ── Core queues ────────────────────────────────────────────────────────────────
export const scrapingQueue = new Queue('scraping', {
  connection: CONNECTION,
  defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, priority: 2 },
});

export const enrichmentQueue = new Queue('enrichment', {
  connection: CONNECTION,
  defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, priority: 3 },
});

export const scoringQueue = new Queue('scoring', {
  connection: CONNECTION,
  defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, priority: 4 },
});

// ── Self-improvement queues ────────────────────────────────────────────────────
export const feedbackQueue = new Queue('feedback', {
  connection: CONNECTION,
  defaultJobOptions: { attempts: 1, removeOnComplete: { count: 30 } },
});

export const optimizerQueue = new Queue('optimizer', {
  connection: CONNECTION,
  defaultJobOptions: { attempts: 1, removeOnComplete: { count: 30 } },
});

// ── Dead-letter queues (failed jobs land here for inspection) ──────────────────
export const scrapingDLQ = new Queue('scraping-dlq', { connection: CONNECTION });
export const enrichmentDLQ = new Queue('enrichment-dlq', { connection: CONNECTION });
export const scoringDLQ = new Queue('scoring-dlq', { connection: CONNECTION });

// ── Queue events (global stalled detection) ────────────────────────────────────
const STALL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

['scraping', 'enrichment', 'scoring'].forEach((name) => {
  const events = new QueueEvents(name, { connection: CONNECTION });
  events.on('stalled', ({ jobId }) => {
    logger.warn(`Job stalled in queue "${name}"`, { jobId, action: 'moved to DLQ' });
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error(`Job failed in queue "${name}"`, { jobId, failedReason });
  });
});

export async function pauseEnrichmentQueue(): Promise<void> {
  await enrichmentQueue.pause();
  logger.warn('Enrichment queue paused (cost guard)');
}

export async function resumeEnrichmentQueue(): Promise<void> {
  await enrichmentQueue.resume();
  logger.info('Enrichment queue resumed');
}

export async function getQueueStats() {
  const [scraping, enrichment, scoring] = await Promise.all([
    scrapingQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    enrichmentQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    scoringQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
  ]);
  return { scraping, enrichment, scoring };
}
