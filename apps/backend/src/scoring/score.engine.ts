/**
 * Opportunity Scoring Engine
 * Higher score = Higher Service Need (Opportunity).
 *
 * Scoring factors (base 100 pts):
 *  - No website:       40 pts  (biggest signal — can't be found online)
 *  - Poor website:     15 pts  (outdated/basic — needs redesign)
 *  - No email:         25 pts  (can't be contacted easily)
 *  - No social:        20 pts  (no social media presence)
 *
 * Industry tier multiplier applied after base score:
 *  - Tier 3 (high-value: law, medical, real estate): ×1.3
 *  - Tier 2 (mid-market: gyms, restaurants, SaaS):   ×1.0
 *  - Tier 1 (low-value: freelancers, cafes):         ×0.5
 */
import { redis } from '../lib/redis';
import { ScoringConfig } from '../models/scoringConfig.model';
import { logger } from '../lib/logger';

const SCORING_CACHE_KEY = 'scoring:config:active';
const SCORING_CACHE_TTL = 300; // 5 minutes

// ── Major brand domain blocklist ─────────────────────────────────────────────
// These are well-known chains / Fortune-500 companies that are not prospects
// for web-design or lead-gen services. Any domain here gets score=0 / priority=low.
const MAJOR_BRAND_DOMAINS = new Set([
  // Fast food / QSR
  'mcdonalds.com','starbucks.com','subway.com','burgerking.com','wendys.com',
  'tacobell.com','kfc.com','dominos.com','pizzahut.com','chipotle.com',
  'dunkindonuts.com','dunkin.com','sonic.com','arbys.com','dairyqueen.com',
  'fiveguys.com','shakeshack.com','panera.com','panerabread.com','papajohns.com',
  'popeyes.com','chickfila.com','whataburger.com','jackinthebox.com','in-n-out.com',
  // Retail / grocery
  'walmart.com','target.com','homedepot.com','lowes.com','bestbuy.com',
  'costco.com','samsclub.com','kroger.com','safeway.com','walgreens.com',
  'cvs.com','riteaid.com','macys.com','nordstrom.com','tjmaxx.com',
  'marshalls.com','kohls.com','jcpenney.com','dollartree.com','familydollar.com',
  'dollargeneral.com','aldi.com','traderjoes.com','publix.com','heb.com',
  'wegmans.com','wholefoods.com','sprouts.com',
  // Fashion / apparel
  'ralphlauren.com','nike.com','adidas.com','gap.com','oldnavy.com',
  'bananarepublic.com','hm.com','zara.com','uniqlo.com','forever21.com',
  'victoriassecret.com','underarmour.com','levis.com','express.com',
  // Gyms / fitness
  'planetfitness.com','24hourfit.com','lafitness.com','equinox.com',
  'anytimefitness.com','orangetheory.com','crunch.com','crunchfitness.com',
  // Hotels / lodging
  'marriott.com','hilton.com','hyatt.com','ihg.com','wyndham.com',
  'bestwestern.com','choicehotels.com','radisson.com','holidayinn.com',
  // Auto
  'ford.com','chevrolet.com','gm.com','toyota.com','honda.com',
  'bmw.com','mercedes-benz.com','audi.com','volkswagen.com','nissan.com',
  'hyundai.com','kia.com','lexus.com','acura.com','infiniti.com',
  // Telecom
  'att.com','verizon.com','tmobile.com','comcast.com','spectrum.com','xfinity.com',
  // Financial
  'chase.com','bankofamerica.com','wellsfargo.com','citibank.com','usbank.com',
  'capitalone.com','americanexpress.com','discover.com',
  // Big tech
  'amazon.com','apple.com','google.com','microsoft.com','meta.com',
]);

/** Returns true if the domain belongs to a major brand that is not a prospect. */
export function isMajorBrand(domain: string): boolean {
  if (!domain) return false;
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  // Exact match OR check if the domain ends with a blocklisted root
  // (e.g. "ny.starbucks.com" → starbucks.com)
  if (MAJOR_BRAND_DOMAINS.has(normalized)) return true;
  for (const brand of MAJOR_BRAND_DOMAINS) {
    if (normalized.endsWith('.' + brand)) return true;
  }
  return false;
}

/** Weights used when no DB config exists — exported for seed.ts */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  noWebsite:        40,
  poorWebsite:      15,
  noEmail:          25,
  noSocialPresence: 20,
};

export interface OpportunityInput {
  hasWebsite: boolean;
  hasEmail: boolean;
  socialLinks: string[];
  websiteQuality: 'outdated' | 'basic' | 'modern' | 'unknown';
  industryTier?: number;
}

export interface OpportunityScoreResult {
  score: number;
  level: 'high' | 'medium' | 'low';
  breakdown: Record<string, number>;
}

/** Pure scoring function — deterministic, no I/O */
export function calculateOpportunityScore(
  input: OpportunityInput,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): OpportunityScoreResult {
  const breakdown: Record<string, number> = {};
  let rawScore = 0;

  const w = { ...DEFAULT_WEIGHTS, ...weights };

  // 1. Website Presence
  if (!input.hasWebsite) {
    breakdown['noWebsite'] = w['noWebsite'] ?? 40;
    rawScore += breakdown['noWebsite'];
  } else if (input.websiteQuality === 'outdated' || input.websiteQuality === 'basic') {
    breakdown['poorWebsite'] = w['poorWebsite'] ?? 15;
    rawScore += breakdown['poorWebsite'];
  }

  // 2. Email Presence
  if (!input.hasEmail) {
    breakdown['noEmail'] = w['noEmail'] ?? 25;
    rawScore += breakdown['noEmail'];
  }

  // 3. Social Presence
  if (!input.socialLinks || input.socialLinks.length === 0) {
    breakdown['noSocialPresence'] = w['noSocialPresence'] ?? 20;
    rawScore += breakdown['noSocialPresence'];
  }

  // 4. Industry tier multiplier
  const tier = input.industryTier ?? 2;
  const tierMultiplier = tier === 3 ? 1.3 : tier === 1 ? 0.5 : 1.0;
  if (tierMultiplier !== 1.0) {
    breakdown['tierMultiplier'] = tierMultiplier;
  }

  const finalScore = Math.min(Math.round(rawScore * tierMultiplier), 100);

  return {
    score: finalScore,
    level: scoreToLevel(finalScore),
    breakdown,
  };
}

function scoreToLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 65) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * Load active scoring weights from DB (Redis-cached for 5 min).
 */
async function loadActiveWeights(): Promise<{ weights: Record<string, number>; version: number }> {
  try {
    const cached = await redis.get(SCORING_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as { weights: Record<string, number>; version: number };
    }

    const config = await ScoringConfig.findOne({ active: true }).lean();
    if (config) {
      const payload = { weights: config.weights as Record<string, number>, version: config.version };
      await redis.setex(SCORING_CACHE_KEY, SCORING_CACHE_TTL, JSON.stringify(payload));
      return payload;
    }
  } catch (err) {
    logger.warn('Failed to load scoring config from DB — using defaults', {
      error: (err as Error).message,
    });
  }

  return { weights: DEFAULT_WEIGHTS, version: 1 };
}

/**
 * Clear the scoring config cache (called by optimizer worker after weight update).
 */
export async function bustScoringCache(): Promise<void> {
  await redis.del(SCORING_CACHE_KEY);
  logger.info('Scoring config cache busted');
}

/**
 * Score a lead using enrichment data + active DB weights.
 * Used by scoring worker and rescore endpoint.
 */
export async function scoreLeadFromDB(data: {
  industry?: string;
  industryTier?: number;
  enrichment: {
    siteStatus?: string;
    email?: string;
    socialLinks?: string[];
    websiteQuality?: string;
    socialConfidence?: 'high' | 'medium' | 'low' | 'unverified';
    dataQualityFlags?: string[];
  };
}): Promise<{
  score: number;
  priority: 'high' | 'medium' | 'low';
  scoreBreakdown: Record<string, number>;
  configVersion: number;
  needsManualReview: boolean;
}> {
  const { enrichment, industryTier } = data;
  const { weights, version } = await loadActiveWeights();

  // Dampen noSocialPresence when detection confidence is weak:
  //   low        → 50%  (bare-domain only — could be pixel/CDN, not actual social absence)
  //   unverified → 25%  (site errored — absence signal cannot be trusted)
  const adjustedWeights = { ...weights };
  const socialAbsent = !enrichment.socialLinks || enrichment.socialLinks.length === 0;
  if (socialAbsent) {
    const base = weights['noSocialPresence'] ?? DEFAULT_WEIGHTS['noSocialPresence'];
    if (enrichment.socialConfidence === 'low') {
      adjustedWeights['noSocialPresence'] = Math.round(base * 0.5);
    } else if (enrichment.socialConfidence === 'unverified') {
      adjustedWeights['noSocialPresence'] = Math.round(base * 0.25);
    }
  }

  const result = calculateOpportunityScore(
    {
      hasWebsite: enrichment.siteStatus === 'live' || enrichment.siteStatus === 'redirect',
      hasEmail: !!enrichment.email,
      socialLinks: enrichment.socialLinks || [],
      websiteQuality: (enrichment.websiteQuality as OpportunityInput['websiteQuality']) || 'unknown',
      industryTier: industryTier ?? 2,
    },
    adjustedWeights,
  );

  // Manual review when uncertain signals pushed a lead to high-opportunity
  const needsManualReview =
    result.level === 'high' &&
    (enrichment.socialConfidence === 'low' ||
     enrichment.socialConfidence === 'unverified' ||
     (enrichment.dataQualityFlags ?? []).some(f => f.includes('unconfirmed') || f.includes('error')));

  return {
    score: result.score,
    priority: result.level,
    scoreBreakdown: result.breakdown,
    configVersion: version,
    needsManualReview,
  };
}
