// @ts-ignore
const EventSource = require('eventsource');
// @ts-ignore
global.EventSource = EventSource.EventSource || EventSource;

import { pb, authenticateAdmin } from './lib/pb';
import { scraperService } from './services/scraper.service';
import { enrichmentService } from './services/enrichment.service';
import { scoringService } from './services/scoring.service';
import { aiService } from './services/ai.service';

/**
 * Main Worker Engine for HydraFox v3.0 (PocketBase Edition)
 */
async function startWorker() {
  await authenticateAdmin();

  console.log('🚀 HydraFox Worker Engine starting...');

  // 1. Process any stale "pending" or "running" jobs on startup
  const staleJobs = await pb.collection('jobs').getFullList({
    filter: 'status = "pending" || status = "running"',
    sort: 'created'
  });

  for (const job of staleJobs) {
    processJob(job);
  }

  // 2. Subscribe to new jobs
  pb.collection('jobs').subscribe('*', async (e: any) => {
    console.log(`[DEBUG] Subscription fired! Action: ${e.action}, Status: ${e.record.status}`);
    if (e.action === 'create' || (e.action === 'update' && e.record.status === 'pending')) {
      console.log(`[DEBUG] Processing job ${e.record.id}`);
      processJob(e.record);
    }
  });

  console.log('📡 Listening for new jobs in PocketBase...');
}

async function processJob(job: any) {
  const jobId = job.id;
  const { type, payload } = job;

  console.log(`[DEBUG] processJob called for ${type} | JobID: ${jobId}`);

  try {
    // Mark as running
    await pb.collection('jobs').update(jobId, { status: 'running', logs: { startedAt: new Date() } });

    switch (type) {
      case 'scraper':
        await scraperService.run(payload, jobId);
        break;
      case 'enrichment':
        await enrichmentService.run(payload, jobId);
        break;
      case 'scoring':
        await scoringService.run(payload, jobId);
        break;
      case 'optimizer':
        await aiService.expandQuery(payload, jobId);
        break;
      default:
        throw new Error(`Unknown job type: ${type}`);
    }

    // Mark as completed
    await pb.collection('jobs').update(jobId, { 
      status: 'completed', 
      logs: { ...job.logs, finishedAt: new Date(), success: true } 
    });
    console.log(`[JOB] Completed ${type} job: ${jobId}`);

  } catch (err) {
    console.error(`[JOB] Failed ${type} job: ${jobId}`, (err as Error).message);
    await pb.collection('jobs').update(jobId, { 
      status: 'failed', 
      logs: { ...job.logs, error: (err as Error).message, finishedAt: new Date() } 
    });
  }
}

startWorker().catch(err => {
  console.error('Fatal Worker Error:', err);
});
