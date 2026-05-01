/**
 * Enrichment worker — processes jobs from the 'enrichment' BullMQ queue.
 *
 * Each job carries: { leadId: string, domain: string, website?: string }
 * Pipeline: Playwright fetch → tech detection → scoring signals → DB write → scoring queue
 */

import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { Lead } from '../models/lead.model';
import { Enrichment } from '../models/enrichment.model';
import { scoringQueue } from '../lib/queues';
import { enrichWebsite } from '../enrichment/enrichment.service';

export interface EnrichJobData {
  leadId: string;
  domain: string;
  website?: string;
}

export const enrichmentWorker = new Worker<EnrichJobData>(
  'enrichment',
  async (job: Job<EnrichJobData>) => {
    const { leadId, domain, website } = job.data;
    logger.info('Enrichment job started', { jobId: job.id, leadId, domain });

    const lead = await Lead.findById(leadId);
    if (!lead) {
      logger.warn('Enrichment: lead not found', { leadId });
      return { skipped: true };
    }

    // ── Real Playwright enrichment ──────────────────────────────────────────
    const result = await enrichWebsite(domain, website ?? lead.website);

    const enrichmentPayload = {
      leadId: lead._id,
      phone: result.phone,
      email: result.email,
      socialLinks: result.socialLinks,
      socialConfidence: result.socialConfidence,
      socialDetectionLayers: result.socialDetectionLayers,
      dataQualityFlags: result.dataQualityFlags,
      websiteQuality: result.websiteQuality,
      techStack: result.techStack,
      cms: result.cms,
      automationLevel: result.automationLevel,
      automationSignals: result.automationSignals,
      siteStatus: result.siteStatus,
      rawHtmlSnapshot: result.rawHtmlSnapshot,
      hasSSL: result.hasSSL,
      hasChatbot: result.hasChatbot,
      hasContactForm: result.hasContactForm,
      mobileFriendly: result.mobileFriendly,
      enrichedAt: new Date(),
    };

    if (result.dataQualityFlags.length > 0) {
      logger.warn('Enrichment: data quality flags raised', { leadId, flags: result.dataQualityFlags });
    }

    const existing = await Enrichment.findOne({ leadId: lead._id });
    if (existing) {
      await Enrichment.findByIdAndUpdate(existing._id, enrichmentPayload);
    } else {
      await Enrichment.create(enrichmentPayload);
    }

    // Sync vital signals to Lead model for fast scoring/access
    if (result.email) lead.email = result.email;
    if (result.phone) lead.phone = result.phone;
    lead.socialLinks = result.socialLinks || [];
    lead.websiteQuality = result.websiteQuality;
    lead.enrichedAt = new Date();

    // Determine lead status based on site reachability
    if (result.siteStatus === 'unreachable') {
      lead.status = 'archived';
      await lead.save();
      logger.warn('Lead archived — site unreachable', { leadId, domain });
      return { enriched: false, archived: true };
    }

    // For live, redirect, or error status — mark as enriched and score
    lead.status = 'enriched';
    await lead.save();

    // ── Enqueue for scoring ──────────────────────────────────────────────────
    await scoringQueue.add('score', { leadId, domain }, { priority: 4 });
    logger.info('Enrichment job complete', {
      jobId: job.id,
      leadId,
      cms: result.cms,
      automationLevel: result.automationLevel,
      siteStatus: result.siteStatus,
    });

    return {
      enriched: true,
      cms: result.cms,
      automationLevel: result.automationLevel,
      siteStatus: result.siteStatus,
    };
  },
  {
    connection: redis,
    concurrency: 2, // Playwright is memory-heavy — keep concurrency low
  },
);
