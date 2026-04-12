/**
 * Scoring worker — processes jobs from the 'scoring' BullMQ queue.
 *
 * Each job carries: { leadId: string, domain: string }
 * Steps:
 *  1. Load enrichment document
 *  2. Call scoreLeadFromDB() (weights from DB, Redis-cached)
 *  3. Write score + priority back to Lead
 *  4. HOT leads → trigger AI analysis (guardedAICall via aiService)
 */

import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { Lead } from '../models/lead.model';
import { Enrichment } from '../models/enrichment.model';
import { scoreLeadFromDB } from '../scoring/score.engine';
import { aiService } from '../ai/ai.service';

export interface ScoringJobData {
  leadId: string;
  domain: string;
}

export const scoringWorker = new Worker<ScoringJobData>(
  'scoring',
  async (job: Job<ScoringJobData>) => {
    const { leadId } = job.data;
    logger.info('Scoring job started', { jobId: job.id, leadId });

    const lead = await Lead.findById(leadId);
    if (!lead) {
      logger.warn('Scoring: lead not found', { leadId });
      return { skipped: true };
    }

    const enrichment = await Enrichment.findOne({ leadId }).lean();
    if (!enrichment) {
      logger.warn('Scoring: enrichment not found', { leadId });
      return { skipped: true };
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

    logger.info('Lead scored', {
      leadId,
      score: result.score,
      priority: result.priority,
    });

    // HOT leads get immediate AI analysis via guardedAICall
    if (result.priority === 'hot') {
      try {
        const analysis = await aiService.analyseHotLead(
          { _id: lead._id, businessName: lead.businessName, domain: lead.domain, industry: lead.industry },
          {
            techStack: enrichment.techStack,
            cms: enrichment.cms,
            performanceScore: enrichment.performanceScore,
            automationLevel: enrichment.automationLevel,
            detectedPains: enrichment.detectedPains,
            rawHtmlSnapshot: enrichment.rawHtmlSnapshot,
          },
        );

        await Enrichment.findOneAndUpdate(
          { leadId },
          {
            detectedPains: analysis.detectedPains,
            primaryPain: analysis.primaryPain,
            pitchAngle: analysis.pitchAngle,
            automationLevel: analysis.automationLevel,
            automationSignals: analysis.automationSignals,
          },
        );

        lead.confidenceScore = analysis.confidenceScore;
        await lead.save();

        logger.info('HOT lead AI analysis complete', { leadId, primaryPain: analysis.primaryPain });
      } catch (err) {
        // Don't fail the whole job if AI analysis errors — log and continue
        logger.error('HOT lead AI analysis failed', {
          leadId,
          error: (err as Error).message,
        });
      }
    }

    return { score: result.score, priority: result.priority };
  },
  {
    connection: redis,
    concurrency: 5,
  },
);
