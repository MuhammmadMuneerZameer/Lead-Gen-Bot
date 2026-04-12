/**
 * Starts all BullMQ workers. Called once at server startup.
 */
import { logger } from '../lib/logger';
import { scraperWorker } from './scraper.worker';
import { enrichmentWorker } from './enrichment.worker';
import { scoringWorker } from './scoring.worker';
import { costGuardWorker } from './costGuard.worker';
import { optimizerWorker } from './optimizer.worker';
import { feedbackWorker } from './feedback.worker';

export function startWorkers(): void {
  const workers = [
    { name: 'scraper', worker: scraperWorker },
    { name: 'enrichment', worker: enrichmentWorker },
    { name: 'scoring', worker: scoringWorker },
    { name: 'costGuard', worker: costGuardWorker },
    { name: 'optimizer', worker: optimizerWorker },
    { name: 'feedback', worker: feedbackWorker },
  ];

  for (const { name, worker } of workers) {
    worker.on('error', (err) => {
      logger.error(`Worker "${name}" error`, { error: err.message });
    });
    worker.on('failed', (job, err) => {
      logger.error(`Worker "${name}" job failed`, { jobId: job?.id, error: err.message });
    });
    logger.debug(`Worker "${name}" registered`);
  }

  logger.info(`${workers.length} BullMQ workers active`);
}
