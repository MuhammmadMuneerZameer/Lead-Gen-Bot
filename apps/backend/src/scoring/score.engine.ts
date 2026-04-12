/**
 * Lead Scoring Engine — pure function, no DB writes, no AI calls.
 * Weights loaded from scoringConfigs collection (Redis-cached 5 min).
 * Must run in < 10ms per lead.
 */
import { redis } from '../lib/redis';
import { ScoringConfig, IScoringConfig } from '../models/scoringConfig.model';
import { IEnrichment } from '../models/enrichment.model';
import { getTierMultiplier } from './industry.tiers';
import { logger } from '../lib/logger';

const SCORING_CACHE_KEY = 'scoring:config:active';
const SCORING_CACHE_TTL = 300; // 5 minutes

export interface EnrichedLeadInput {
  industry: string;
  industryTier: 1 | 2 | 3;
  enrichment: Pick<
    IEnrichment,
    | 'automationLevel'
    | 'performanceScore'
    | 'siteQualityScore'
    | 'hasSSL'
    | 'mobileFriendly'
    | 'socialActivity'
    | 'hasBookingSystem'
    | 'cms'
    | 'hasChatbot'
    | 'hasContactForm'
    | 'siteStatus'
  >;
}

export interface ScoreResult {
  score: number;
  priority: 'hot' | 'warm' | 'cold';
  scoreBreakdown: Record<string, number>;
  configVersion: number;
}

/** Load active config from Redis cache → fallback to MongoDB */
export async function getCachedScoringConfig(): Promise<IScoringConfig> {
  const cached = await redis.get(SCORING_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached) as IScoringConfig;
  }

  const config = await ScoringConfig.findOne({ active: true }).lean();
  if (!config) throw new Error('No active scoring config found — run seed first');

  await redis.setex(SCORING_CACHE_KEY, SCORING_CACHE_TTL, JSON.stringify(config));
  return config as unknown as IScoringConfig;
}

/** Invalidate scoring cache — called after feedback worker updates weights */
export async function bustScoringCache(): Promise<void> {
  await redis.del(SCORING_CACHE_KEY);
  logger.info('Scoring config cache busted');
}

/** Pure scoring function — deterministic, no I/O */
export function scoreLead(lead: EnrichedLeadInput, config: IScoringConfig): ScoreResult {
  const weights = config.weights;
  const breakdown: Record<string, number> = {};
  let rawScore = 0;

  // ── Dead site: instant skip ──────────────────────────────────────────────────
  if (lead.enrichment.siteStatus === 'unreachable') {
    return { score: 0, priority: 'cold', scoreBreakdown: { dead_site: -999 }, configVersion: config.version };
  }

  // ── Duplicate guard (score -999 used by caller to block write) ───────────────
  // Fingerprint check is done in dedup.ts BEFORE scoring is called.

  // ── Factor evaluation ────────────────────────────────────────────────────────
  const e = lead.enrichment;

  if (e.automationLevel === 'none') {
    const pts = weights['noAutomation'] ?? 25;
    breakdown['noAutomation'] = pts;
    rawScore += pts;
  }

  if (e.performanceScore < 50 || e.siteQualityScore < 40) {
    const pts = weights['outdatedWebsite'] ?? 20;
    breakdown['outdatedWebsite'] = pts;
    rawScore += pts;
  }

  if (!e.hasSSL) {
    const pts = weights['noSSL'] ?? 20;
    breakdown['noSSL'] = pts;
    rawScore += pts;
  }

  if (!e.mobileFriendly) {
    const pts = weights['mobileUnfriendly'] ?? 15;
    breakdown['mobileUnfriendly'] = pts;
    rawScore += pts;
  }

  if (e.socialActivity === 'active') {
    const pts = weights['activeOnSocial'] ?? 15;
    breakdown['activeOnSocial'] = pts;
    rawScore += pts;
  }

  if (!e.hasBookingSystem) {
    const pts = weights['noBooking'] ?? 15;
    breakdown['noBooking'] = pts;
    rawScore += pts;
  }

  if (e.cms === 'Wix' || e.cms === 'Squarespace') {
    const pts = weights['oldCMS'] ?? 10;
    breakdown['oldCMS'] = pts;
    rawScore += pts;
  }

  if (!e.hasChatbot && lead.industryTier >= 2) {
    const pts = weights['noChatbot'] ?? 10;
    breakdown['noChatbot'] = pts;
    rawScore += pts;
  }

  if (!e.hasContactForm) {
    const pts = weights['noContactForm'] ?? 5;
    breakdown['noContactForm'] = pts;
    rawScore += pts;
  }

  // ── Negative signals ─────────────────────────────────────────────────────────
  if (e.automationLevel === 'advanced') {
    const pts = weights['advancedAutomation'] ?? -15;
    breakdown['advancedAutomation'] = pts;
    rawScore += pts;
  }

  if (e.performanceScore >= 90) {
    const pts = weights['highPerfSite'] ?? -10;
    breakdown['highPerfSite'] = pts;
    rawScore += pts;
  }

  if (lead.industryTier === 1) {
    const pts = weights['tier1Industry'] ?? -20;
    breakdown['tier1Industry'] = pts;
    rawScore += pts;
  }

  // ── Industry tier multiplier ─────────────────────────────────────────────────
  const multiplier = getTierMultiplier(lead.industryTier);
  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore * multiplier)));

  return {
    score: finalScore,
    priority: scoreToPriority(finalScore),
    scoreBreakdown: breakdown,
    configVersion: config.version,
  };
}

/** Full pipeline: load config from cache + score */
export async function scoreLeadFromDB(lead: EnrichedLeadInput): Promise<ScoreResult> {
  const config = await getCachedScoringConfig();
  return scoreLead(lead, config);
}

function scoreToPriority(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 80) return 'hot';
  if (score >= 55) return 'warm';
  return 'cold';
}

/** Default scoring weights — seeded into DB on first startup */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  noAutomation: 25,
  outdatedWebsite: 20,
  noSSL: 20,
  mobileUnfriendly: 15,
  activeOnSocial: 15,
  noBooking: 15,
  oldCMS: 10,
  noChatbot: 10,
  noContactForm: 5,
  advancedAutomation: -15,
  highPerfSite: -10,
  tier1Industry: -20,
};
