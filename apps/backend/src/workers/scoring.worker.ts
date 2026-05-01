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
import { scoreLeadFromDB, isMajorBrand } from '../scoring/score.engine';
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

    // Pre-filter: major brands are not web-services prospects
    if (isMajorBrand(lead.domain)) {
      lead.opportunityScore = 0;
      lead.opportunityLevel = 'low';
      lead.scoreBreakdown = { majorBrandFiltered: 1 };
      lead.scoringConfigVersion = 0;
      await lead.save();
      logger.info('Lead auto-filtered: major brand', { leadId, domain: lead.domain });
      return { score: 0, level: 'low', filtered: true };
    }

    const enrichment = await Enrichment.findOne({ leadId }).lean();
    if (!enrichment) {
      logger.warn('Scoring: enrichment not found', { leadId });
      return { skipped: true };
    }

    const result = await scoreLeadFromDB({
      industry: lead.industry,
      industryTier: lead.industryTier,
      enrichment: {
        siteStatus: enrichment.siteStatus,
        email: enrichment.email,
        socialLinks: enrichment.socialLinks,
        websiteQuality: enrichment.websiteQuality,
        socialConfidence: enrichment.socialConfidence,
        dataQualityFlags: enrichment.dataQualityFlags,
      },
    });

    lead.opportunityScore = result.score;
    lead.opportunityLevel = result.priority as 'high' | 'medium' | 'low';
    lead.scoreBreakdown = result.scoreBreakdown;
    lead.scoringConfigVersion = result.configVersion;
    await lead.save();

    if (result.needsManualReview) {
      await Enrichment.findOneAndUpdate({ leadId }, { needsManualReview: true });
      logger.warn('Lead flagged for manual review — uncertain signals drove high score', {
        leadId,
        socialConfidence: enrichment.socialConfidence,
        dataQualityFlags: enrichment.dataQualityFlags,
      });
    }

    logger.info('Lead scored', {
      leadId,
      score: result.score,
      level: result.priority,
      needsManualReview: result.needsManualReview,
    });

    // HIGH opportunity leads get immediate AI analysis
    // Skip if already analyzed (prevents wasting tokens on re-scores)
    const alreadyAnalyzed = enrichment.primaryPain && (enrichment.detectedPains?.length ?? 0) > 0;
    if (result.priority === 'high' && !alreadyAnalyzed) {
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

        logger.info('HIGH opportunity AI analysis complete', { leadId, primaryPain: analysis.primaryPain });
      } catch (err) {
        logger.error('HIGH opportunity AI analysis failed', {
          leadId,
          error: (err as Error).message,
        });
      }
    }

    return { score: result.score, level: result.priority };
  },
  {
    connection: redis,
    concurrency: 5,
  },
);
