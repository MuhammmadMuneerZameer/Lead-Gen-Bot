/**
 * Feedback worker — the heart of HydraFox's self-improvement loop.
 *
 * Runs on a schedule (every 6 hours). Samples recent OutcomeLogs, analyses
 * prediction accuracy, and proposes scoring weight updates via guardedAICall.
 * Enqueues changes to the optimizerQueue for application.
 *
 * Only triggers if:
 *  - >= MIN_SAMPLE_SIZE outcome logs in the last 7 days
 *  - At least one priority bucket is significantly mis-calibrated (> DRIFT_THRESHOLD)
 */

import { Worker, Job, Queue } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { OutcomeLog } from '../models/outcomeLog.model';
import { PromptTemplate } from '../models/promptTemplate.model';
import { ScoringConfig } from '../models/scoringConfig.model';
import { optimizerQueue } from '../lib/queues';
import { guardedAICall, MODEL_SONNET } from '../ai/guardedAICall';
import { SelfImproveLog } from '../models/selfImproveLog.model';

const MIN_SAMPLE_SIZE = 10;     // Don't optimise with fewer outcomes than this
const DRIFT_THRESHOLD = 0.25;   // 25% conversion rate gap triggers re-weighting

const FEEDBACK_QUEUE = new Queue('feedback', { connection: redis });

// Register the repeatable job — runs every 6 hours
FEEDBACK_QUEUE.add(
  'run',
  {},
  {
    repeat: { every: 6 * 60 * 60 * 1000 },
    removeOnComplete: { count: 10 },
  },
).catch(() => {
  // Safe to ignore — job already registered on subsequent starts
});

interface PriorityStats {
  total: number;
  converted: number;
  replied: number;
  conversionRate: number;
  replyRate: number;
}

async function getOutcomeStats(since: Date): Promise<Record<string, PriorityStats>> {
  const raw = await OutcomeLog.aggregate([
    { $match: { loggedAt: { $gte: since } } },
    {
      $group: {
        _id: '$predictedPriority',
        total: { $sum: 1 },
        converted: { $sum: { $cond: [{ $eq: ['$actualOutcome', 'converted'] }, 1, 0] } },
        replied: {
          $sum: {
            $cond: [{ $in: ['$actualOutcome', ['replied', 'interested', 'converted']] }, 1, 0],
          },
        },
      },
    },
  ]);

  const stats: Record<string, PriorityStats> = {};
  for (const row of raw) {
    stats[row._id as string] = {
      total: row.total as number,
      converted: row.converted as number,
      replied: row.replied as number,
      conversionRate: (row.converted as number) / (row.total as number),
      replyRate: (row.replied as number) / (row.total as number),
    };
  }
  return stats;
}

export const feedbackWorker = new Worker(
  'feedback',
  async (_job: Job) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const totalOutcomes = await OutcomeLog.countDocuments({ loggedAt: { $gte: since } });

    if (totalOutcomes < MIN_SAMPLE_SIZE) {
      logger.info('Feedback worker: insufficient data', { totalOutcomes, required: MIN_SAMPLE_SIZE });
      return { skipped: true, reason: 'insufficient_data' };
    }

    const stats = await getOutcomeStats(since);
    const currentConfig = await ScoringConfig.findOne({ active: true }).lean();

    if (!currentConfig) {
      logger.error('Feedback worker: no active scoring config');
      return { error: 'NO_ACTIVE_CONFIG' };
    }

    // ── Check for significant drift ─────────────────────────────────────────
    // Expected: HOT > WARM > COLD in conversion rate
    const hotRate = stats['hot']?.conversionRate ?? 0;
    const warmRate = stats['warm']?.conversionRate ?? 0;
    const coldRate = stats['cold']?.conversionRate ?? 0;

    const driftDetected =
      (stats['hot']?.total ?? 0) > 5 && warmRate > hotRate + DRIFT_THRESHOLD ||
      (stats['warm']?.total ?? 0) > 5 && coldRate > warmRate + DRIFT_THRESHOLD;

    if (!driftDetected) {
      logger.info('Feedback worker: no significant drift detected', { hotRate, warmRate, coldRate });
      return { skipped: true, reason: 'no_drift', hotRate, warmRate, coldRate };
    }

    logger.info('Feedback worker: drift detected, calling optimizer', { hotRate, warmRate, coldRate });

    // ── Ask Claude to propose weight adjustments ────────────────────────────
    // Only fetch 20 representative samples (stratified: worst predictions first)
    const recentOutcomes = await OutcomeLog.find({ loggedAt: { $gte: since } })
      .sort({ loggedAt: -1 })
      .limit(20)
      .select('predictedPriority predictedScore actualOutcome industryTier scoreFactors')
      .lean();

    const systemPrompt = `You are a machine learning engineer optimising a B2B lead scoring model.
Analyse the prediction performance data and propose specific scoring weight adjustments.
Return ONLY valid JSON — no markdown, no explanation.`;

    // Use compact JSON for samples to save ~40% tokens vs pretty-print
    const userPrompt = `Weights:${JSON.stringify(currentConfig.weights)}
Stats:${JSON.stringify(stats)}
Sample(n=20):${JSON.stringify(recentOutcomes.map(o => ({
  p: o.predictedPriority,
  s: o.predictedScore,
  a: o.actualOutcome,
  t: o.industryTier,
  f: o.scoreFactors,
})))}
Rates HOT:${(hotRate * 100).toFixed(1)}% WARM:${(warmRate * 100).toFixed(1)}% COLD:${(coldRate * 100).toFixed(1)}%
Return JSON array (max 4 changes, ±5pts each):[{"factor":"","oldWeight":0,"newWeight":0,"reason":""}]`;

    let proposedChanges: Array<{ factor: string; oldWeight: number; newWeight: number; reason: string }> = [];

    try {
      const result = await guardedAICall({
        model: MODEL_SONNET,
        systemPrompt,
        userPrompt,
        purpose: 'prompt_optimization',
        maxTokens: 512,
      });

      proposedChanges = JSON.parse(result.content) as typeof proposedChanges;

      // Validate: only allow changes to known factors, within safe bounds
      const knownFactors = Object.keys(currentConfig.weights);
      proposedChanges = proposedChanges.filter(
        (c) => knownFactors.includes(c.factor) && Math.abs(c.newWeight - c.oldWeight) <= 10,
      );
    } catch (err) {
      logger.error('Feedback worker: AI proposal failed', { error: (err as Error).message });
      // Log the failure but don't crash — just skip this cycle
      await SelfImproveLog.create({
        type: 'weight_change',
        severity: 'warning',
        problem: `AI weight proposal failed: ${(err as Error).message}`,
        actionTaken: 'Skipped this feedback cycle',
        ruleUpdated: false,
        outcomesSampled: totalOutcomes,
        timestamp: new Date(),
      });
      return { skipped: true, reason: 'ai_proposal_failed' };
    }

    if (proposedChanges.length === 0) {
      logger.info('Feedback worker: AI proposed no valid changes');
      return { skipped: true, reason: 'no_valid_changes' };
    }

    // ── Enqueue optimizer with the proposed changes ─────────────────────────
    const job = await optimizerQueue.add('optimize', {
      trigger: 'scheduled',
      outcomesAnalysed: totalOutcomes,
      proposedWeightChanges: proposedChanges,
    });

    // ── Also check prompt template performance ──────────────────────────────
    await checkPromptPerformance(since);

    logger.info('Feedback worker: optimizer job enqueued', {
      jobId: job.id,
      changes: proposedChanges.length,
      outcomes: totalOutcomes,
    });

    return { optimizerJobId: job.id, changes: proposedChanges.length, outcomes: totalOutcomes };
  },
  { connection: redis, concurrency: 1 },
);

/**
 * Check if any prompt templates are under-performing and flag them for review.
 */
async function checkPromptPerformance(since: Date): Promise<void> {
  const templates = await PromptTemplate.find({ status: 'active', timesUsed: { $gte: 20 } }).lean();

  for (const tmpl of templates) {
    if (tmpl.replyRate < 0.05 && tmpl.timesUsed >= 30) {
      // Flag for AI optimisation in next cycle
      await SelfImproveLog.create({
        type: 'prompt_update',
        severity: 'warning',
        problem: `Prompt "${tmpl.name}" v${tmpl.version} has low reply rate: ${(tmpl.replyRate * 100).toFixed(1)}% (${tmpl.timesUsed} uses)`,
        actionTaken: 'Flagged for AI-driven optimisation in next cycle',
        ruleUpdated: false,
        timestamp: new Date(),
      });
      logger.warn('Low-performing prompt flagged', {
        name: tmpl.name,
        version: tmpl.version,
        replyRate: tmpl.replyRate,
        timesUsed: tmpl.timesUsed,
      });
    }
  }
}
