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
      leadId,
      ...result,
      enrichedAt: new Date(),
    };

    const existing = await Enrichment.findOne({ leadId });
    if (existing) {
      await Enrichment.findByIdAndUpdate(existing._id, enrichmentPayload);
    } else {
      await Enrichment.create(enrichmentPayload);
    }

    lead.status = result.siteStatus === 'unreachable' ? 'archived' : 'enriched';
    lead.enrichedAt = new Date();
    await lead.save();

    if (result.siteStatus === 'unreachable') {
      logger.warn('Lead archived — site unreachable', { leadId, domain });
      return { enriched: false, archived: true };
    }

    // ── Enqueue for scoring ──────────────────────────────────────────────────
    await scoringQueue.add('score', { leadId, domain }, { priority: 4 });
    logger.info('Enrichment job complete', { jobId: job.id, leadId, cms: result.cms, automationLevel: result.automationLevel });
    return { enriched: true, cms: result.cms, automationLevel: result.automationLevel };
  },
  {
    connection: redis,
    concurrency: 2, // Playwright is memory-heavy — keep concurrency low
  },
);
