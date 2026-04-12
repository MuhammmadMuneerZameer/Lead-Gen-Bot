/**
 * Scraper worker — processes jobs from the 'scraping' BullMQ queue.
 *
 * Each job: { source: 'gmaps'|'linkedin'|'instagram', query: string, location?: string }
 * → scrapeSource() → mergeOrCreate() (dedup) → enrichmentQueue
 */

import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { mergeOrCreate } from '../utils/dedup';
import { enrichmentQueue } from '../lib/queues';
import { scrapeSource } from '../scrapers/scrapers.service';

export interface ScrapeJobData {
  source: 'gmaps' | 'linkedin' | 'instagram';
  query: string;
  location?: string;
  maxResults?: number;
}

export const scraperWorker = new Worker<ScrapeJobData>(
  'scraping',
  async (job: Job<ScrapeJobData>) => {
    const { source, query, location, maxResults = 20 } = job.data;
    logger.info('Scraper job started', { jobId: job.id, source, query, location });

    const rawResults = await scrapeSource(source, query, location, maxResults);
    logger.info('Scraper: raw results fetched', { count: rawResults.length, source });

    let created = 0;
    let skipped = 0;

    for (const raw of rawResults) {
      try {
        const { isNew, lead } = await mergeOrCreate(
          { domain: raw.domain, businessName: raw.businessName, source, sourceId: raw.sourceId },
          { website: raw.website, industry: raw.industry, location: raw.location },
        );

        if (isNew) {
          await enrichmentQueue.add(
            'enrich',
            { leadId: String(lead._id), domain: raw.domain, website: raw.website },
            { priority: 3 },
          );
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        logger.error('Scraper: failed to save lead', {
          domain: raw.domain,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Scraper job complete', { jobId: job.id, source, created, skipped });
    return { created, skipped };
  },
  {
    connection: redis,
    concurrency: 1, // Only 1 scrape job at a time — avoids IP bans
  },
);
