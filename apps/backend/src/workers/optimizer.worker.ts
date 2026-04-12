/**
 * Optimizer worker — processes jobs from the 'optimizer' BullMQ queue.
 *
 * Triggered by the feedback worker after sampling enough outcomes.
 * Adjusts scoring weights and busts the Redis cache so the next scoring
 * run picks up the new weights immediately.
 */

import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { ScoringConfig } from '../models/scoringConfig.model';
import { SelfImproveLog } from '../models/selfImproveLog.model';
import { bustScoringCache } from '../scoring/score.engine';

export interface OptimizerJobData {
  trigger: 'scheduled' | 'manual';
  outcomesAnalysed: number;
  proposedWeightChanges: Array<{
    factor: string;
    oldWeight: number;
    newWeight: number;
    reason: string;
  }>;
}

export const optimizerWorker = new Worker<OptimizerJobData>(
  'optimizer',
  async (job: Job<OptimizerJobData>) => {
    const { proposedWeightChanges, outcomesAnalysed, trigger } = job.data;
    logger.info('Optimizer job started', { jobId: job.id, trigger, outcomesAnalysed });

    if (!proposedWeightChanges?.length) {
      logger.info('Optimizer: no weight changes proposed — skipping');
      return { skipped: true };
    }

    const currentConfig = await ScoringConfig.findOne({ active: true });
    if (!currentConfig) {
      logger.error('Optimizer: no active scoring config found');
      return { error: 'NO_ACTIVE_CONFIG' };
    }

    const newWeights = { ...currentConfig.weights };
    for (const change of proposedWeightChanges) {
      newWeights[change.factor] = change.newWeight;
    }

    // Create new version (pre-save hook increments version + deactivates old)
    const newConfig = new ScoringConfig({
      weights: newWeights,
      industryTiers: currentConfig.industryTiers,
      generatedBy: 'feedback_worker',
      changeLog: proposedWeightChanges,
      active: true,
    });
    await newConfig.save();

    await bustScoringCache();

    await SelfImproveLog.create({
      type: 'weight_change',
      severity: 'info',
      problem: `Scoring weights updated based on ${outcomesAnalysed} outcome samples`,
      actionTaken: `Created scoring config v${newConfig.version} with ${proposedWeightChanges.length} weight changes`,
      ruleUpdated: true,
      ruleDetails: {
        field: 'scoringConfig.weights',
        oldValue: currentConfig.weights,
        newValue: newWeights,
      },
      outcomesSampled: outcomesAnalysed,
      timestamp: new Date(),
    });

    logger.info('Optimizer job complete', {
      jobId: job.id,
      newConfigVersion: newConfig.version,
      changes: proposedWeightChanges.length,
    });

    return { newConfigVersion: newConfig.version, changes: proposedWeightChanges.length };
  },
  {
    connection: redis,
    concurrency: 1,
  },
);
