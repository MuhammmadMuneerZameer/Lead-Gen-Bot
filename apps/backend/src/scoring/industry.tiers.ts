/**
 * Default industry tier assignments.
 * Stored in scoringConfigs.industryTiers — updated by feedback worker.
 * These are the SEED values only. Runtime values always come from DB.
 *
 * Tier 3 ×1.3 — high-ticket, strong ROI
 * Tier 2 ×1.0 — mid-market baseline
 * Tier 1 ×0.5 — low-value, deprioritize
 */
export const DEFAULT_INDUSTRY_TIERS: Record<string, number> = {
  // Tier 3 — High-ticket
  'law firm': 3,
  'legal services': 3,
  'medical clinic': 3,
  'dental clinic': 3,
  'real estate agency': 3,
  'financial advisor': 3,
  'financial services': 3,
  'recruiting firm': 3,
  'staffing agency': 3,
  'enterprise software': 3,
  'luxury services': 3,
  'insurance agency': 3,
  'accounting firm': 3,
  'consulting': 3,

  // Tier 2 — Mid-market
  gym: 2,
  fitness: 2,
  'e-commerce': 2,
  ecommerce: 2,
  'marketing agency': 2,
  'digital agency': 2,
  'restaurant chain': 2,
  restaurant: 2,
  'saas startup': 2,
  saas: 2,
  'trade business': 2,
  plumber: 2,
  electrician: 2,
  hvac: 2,
  contractor: 2,
  'auto dealership': 2,
  hotel: 2,
  'spa & wellness': 2,
  spa: 2,
  pharmacy: 2,
  veterinarian: 2,

  // Tier 1 — Low-value
  'solo freelancer': 1,
  freelancer: 1,
  'small cafe': 1,
  cafe: 1,
  'local ngo': 1,
  ngo: 1,
  nonprofit: 1,
  'basic retail': 1,
  retail: 1,
};

export const TIER_MULTIPLIERS: Record<number, number> = {
  3: 1.3,
  2: 1.0,
  1: 0.5,
};

export function getTierMultiplier(tier: number): number {
  return TIER_MULTIPLIERS[tier] ?? 1.0;
}

export function getIndustryTier(industry: string): number {
  const normalized = industry.toLowerCase().trim();
  return DEFAULT_INDUSTRY_TIERS[normalized] ?? 2; // default to Tier 2
}
