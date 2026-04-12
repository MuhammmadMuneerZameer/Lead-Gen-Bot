/**
 * Analytics router — all read-only aggregation queries.
 * Powers the dashboard stats, charts, and cost tracking views.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { Lead } from '../../models/lead.model';
import { Enrichment } from '../../models/enrichment.model';
import { OutcomeLog } from '../../models/outcomeLog.model';
import { CostLedger } from '../../models/costLedger.model';
import { SelfImproveLog } from '../../models/selfImproveLog.model';
import { getDailySpend } from '../../ai/guardedAICall';
import { getQueueStats } from '../../lib/queues';
import { logger } from '../../lib/logger';

const router = Router();

// ── GET /api/analytics/dashboard ─────────────────────────────────────────────
// Single endpoint for all dashboard KPIs — minimises round trips.

router.get('/dashboard', authenticate, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      leadsToday,
      hotQueue,
      warmQueue,
      coldQueue,
      enrichedToday,
      contactedLast7d,
      wonLast30d,
      totalLeads,
      aiCostToday,
      queueStats,
      scoreDistribution,
    ] = await Promise.all([
      Lead.countDocuments({ createdAt: { $gte: startOfDay } }),
      Lead.countDocuments({ priority: 'hot', status: { $nin: ['archived', 'won', 'lost'] } }),
      Lead.countDocuments({ priority: 'warm', status: { $nin: ['archived', 'won', 'lost'] } }),
      Lead.countDocuments({ priority: 'cold', status: { $nin: ['archived', 'won', 'lost'] } }),
      Lead.countDocuments({ enrichedAt: { $gte: startOfDay } }),
      Lead.countDocuments({ status: 'contacted', updatedAt: { $gte: last7Days } }),
      Lead.countDocuments({ status: 'won', updatedAt: { $gte: last30Days } }),
      Lead.countDocuments(),
      getDailySpend(),
      getQueueStats(),
      Lead.aggregate([
        { $match: { score: { $gt: 0 } } },
        { $bucket: { groupBy: '$score', boundaries: [0, 20, 40, 55, 70, 80, 101], default: 'other',
            output: { count: { $sum: 1 } } } },
      ]),
    ]);

    res.json({
      kpis: {
        leadsToday,
        hotQueue,
        warmQueue,
        coldQueue,
        enrichedToday,
        contactedLast7d,
        wonLast30d,
        totalLeads,
        aiCostToday: parseFloat(aiCostToday.toFixed(4)),
      },
      queues: queueStats,
      scoreDistribution,
    });
  } catch (err) {
    logger.error('GET /analytics/dashboard error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/pipeline ──────────────────────────────────────────────
// Daily lead counts over the last N days — for the line/bar chart.

router.get('/pipeline', authenticate, async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const daily = await Lead.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: 1 },
          hot: { $sum: { $cond: [{ $eq: ['$priority', 'hot'] }, 1, 0] } },
          warm: { $sum: { $cond: [{ $eq: ['$priority', 'warm'] }, 1, 0] } },
          cold: { $sum: { $cond: [{ $eq: ['$priority', 'cold'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ days, data: daily });
  } catch (err) {
    logger.error('GET /analytics/pipeline error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/outcomes ──────────────────────────────────────────────
// Outcome rates by industry tier — shows model prediction accuracy.

router.get('/outcomes', authenticate, async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '30'), 10), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const outcomes = await OutcomeLog.aggregate([
      { $match: { loggedAt: { $gte: since } } },
      {
        $group: {
          _id: { priority: '$predictedPriority', outcome: '$actualOutcome' },
          count: { $sum: 1 },
          avgDaysToReply: { $avg: '$daysToReply' },
          totalDealValue: { $sum: { $ifNull: ['$dealValue', 0] } },
        },
      },
      { $sort: { '_id.priority': 1, '_id.outcome': 1 } },
    ]);

    // Conversion rate per priority bucket
    const conversionByPriority = await OutcomeLog.aggregate([
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

    res.json({ days, outcomes, conversionByPriority });
  } catch (err) {
    logger.error('GET /analytics/outcomes error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/costs ─────────────────────────────────────────────────
// Daily AI cost breakdown by model and purpose.

router.get('/costs', authenticate, async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? '14'), 10), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [dailyCosts, byModel, byPurpose, totalSpend, cacheHitRate] = await Promise.all([
      CostLedger.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            costUSD: { $sum: '$costUSD' },
            calls: { $sum: 1 },
            cacheHits: { $sum: { $cond: ['$cacheHit', 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      CostLedger.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$aiModel', costUSD: { $sum: '$costUSD' }, calls: { $sum: 1 } } },
      ]),
      CostLedger.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: '$purpose', costUSD: { $sum: '$costUSD' }, calls: { $sum: 1 } } },
      ]),
      CostLedger.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$costUSD' }, calls: { $sum: 1 } } },
      ]),
      CostLedger.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            hits: { $sum: { $cond: ['$cacheHit', 1, 0] } },
          },
        },
      ]),
    ]);

    const total = totalSpend[0] ?? { total: 0, calls: 0 };
    const cache = cacheHitRate[0] ?? { total: 0, hits: 0 };

    res.json({
      days,
      dailyCosts,
      byModel,
      byPurpose,
      summary: {
        totalCostUSD: parseFloat((total.total as number).toFixed(4)),
        totalCalls: total.calls,
        cacheHitRate: cache.total > 0 ? parseFloat(((cache.hits as number) / (cache.total as number)).toFixed(3)) : 0,
      },
    });
  } catch (err) {
    logger.error('GET /analytics/costs error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/industries ────────────────────────────────────────────
// Lead count + avg score per industry — shows where best leads come from.

router.get('/industries', authenticate, async (_req: Request, res: Response) => {
  try {
    const data = await Lead.aggregate([
      { $match: { industry: { $exists: true, $ne: '' } } },
      {
        $group: {
          _id: '$industry',
          count: { $sum: 1 },
          avgScore: { $avg: '$score' },
          hot: { $sum: { $cond: [{ $eq: ['$priority', 'hot'] }, 1, 0] } },
          warm: { $sum: { $cond: [{ $eq: ['$priority', 'warm'] }, 1, 0] } },
          won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    res.json({ data });
  } catch (err) {
    logger.error('GET /analytics/industries error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/analytics/self-improve ──────────────────────────────────────────
// Recent self-improvement events (weight changes, prompt updates).

router.get('/self-improve', authenticate, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);

    const logs = await SelfImproveLog.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ data: logs });
  } catch (err) {
    logger.error('GET /analytics/self-improve error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
