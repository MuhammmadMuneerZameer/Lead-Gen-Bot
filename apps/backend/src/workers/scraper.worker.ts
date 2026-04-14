/**
 * Scraper worker — processes jobs from the 'scraping' BullMQ queue.
 *
 * Each job: { sources[], query, location?, maxResults?, autoExpand? }
 *
 * Multi-source: iterates over all requested sources sequentially.
 * autoExpand=true → uses QueryExpansionService for city-targeted queries.
 */

import { Worker, Job } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { mergeOrCreate } from '../utils/dedup';
import { enrichmentQueue } from '../lib/queues';
import { scrapeSource, ScrapeSource } from '../scrapers/scrapers.service';
import { QueryExpansionService } from '../services/queryExpansion.service';

export interface ScrapeJobData {
  /** Single source (legacy) or array of sources (multi-source) */
  source?: ScrapeSource;
  sources?: ScrapeSource[];
  query: string;
  location?: string;
  maxResults?: number;
  autoExpand?: boolean;
}

async function scrapeAndSave(
  source: ScrapeSource,
  query: string,
  location: string | undefined,
  maxResults: number,
): Promise<{ created: number; skipped: number }> {
  const rawResults = await scrapeSource(source, query, location, maxResults);
  logger.info('Scraper: results from sub-query', { source, query, location, count: rawResults.length });

  let created = 0;
  let skipped = 0;

  for (const raw of rawResults) {
    try {
      const { isNew, lead } = await mergeOrCreate(
        {
          domain: raw.domain,
          businessName: raw.businessName,
          source,
          sourceId: raw.sourceId,
        },
        {
          website: raw.website,
          industry: raw.industry,
          location: raw.location,
          // If the scraper already found phone/email (e.g. Yellow Pages), save them
          ...(raw.phone ? { phone: raw.phone } : {}),
          ...(raw.email ? { email: raw.email } : {}),
        },
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

  return { created, skipped };
}

export const scraperWorker = new Worker<ScrapeJobData>(
  'scraping',
  async (job: Job<ScrapeJobData>) => {
    const {
      source,
      sources,
      query,
      location,
      maxResults = 20,
      autoExpand = false,
    } = job.data;

    // Resolve the list of sources to run
    const activeSources: ScrapeSource[] = sources?.length
      ? sources
      : source
      ? [source]
      : ['gmaps'];

    logger.info('Scraper job started', {
      jobId: job.id,
      sources: activeSources,
      query,
      location,
      autoExpand,
    });

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const src of activeSources) {
      logger.info(`Scraper: running source "${src}"`, { query, location });
      try {
        if (autoExpand && !location) {
          const expandedQueries = QueryExpansionService.expandQuery(query, 5);
          logger.info('Scraper: auto-expanding query', {
            source: src,
            original: query,
            expansions: expandedQueries.length,
          });

          for (const expandedQuery of expandedQueries) {
            try {
              const { created, skipped } = await scrapeAndSave(
                src,
                expandedQuery,
                undefined,
                Math.ceil(maxResults / expandedQueries.length) + 2,
              );
              totalCreated += created;
              totalSkipped += skipped;
            } catch (err) {
              logger.warn('Scraper: sub-query failed', {
                source: src,
                query: expandedQuery,
                error: (err as Error).message,
              });
            }
          }
        } else {
          const { created, skipped } = await scrapeAndSave(src, query, location, maxResults);
          totalCreated += created;
          totalSkipped += skipped;
        }
      } catch (err) {
        logger.warn('Scraper: source failed, continuing with remaining sources', {
          source: src,
          error: (err as Error).message,
        });
      }
    }

    logger.info('Scraper job complete', {
      jobId: job.id,
      sources: activeSources,
      created: totalCreated,
      skipped: totalSkipped,
    });

    return { created: totalCreated, skipped: totalSkipped };
  },
  {
    connection: redis,
    concurrency: 1, // Only 1 scrape at a time — avoids IP bans
  },
);
