/**
 * seed.ts — run once to populate the DB with the data every other part depends on.
 *
 * Idempotent: safe to run multiple times; skips already-seeded data.
 *
 * Usage:
 *   npx tsx src/seed.ts
 *   or set SEED_DB=true and it runs automatically on server start.
 */

import 'dotenv-safe/config';
import { connectDB, disconnectDB } from './lib/db';
import { logger } from './lib/logger';
import { ScoringConfig } from './models/scoringConfig.model';
import { PromptTemplate } from './models/promptTemplate.model';
import { DEFAULT_WEIGHTS } from './scoring/score.engine';
import { DEFAULT_INDUSTRY_TIERS } from './scoring/industry.tiers';
import { User, hashPassword } from './models/user.model';

// ── Seed: ScoringConfig ─────────────────────────────────────────────────────

async function seedScoringConfig(): Promise<void> {
  const existing = await ScoringConfig.findOne({ active: true });
  if (existing) {
    logger.info('ScoringConfig seed skipped — active config already exists', { version: existing.version });
    return;
  }

  const config = new ScoringConfig({
    version: 1,
    active: true,
    weights: DEFAULT_WEIGHTS,
    industryTiers: DEFAULT_INDUSTRY_TIERS,
    generatedBy: 'manual',
    changeLog: [],
  });
  await config.save();
  logger.info('ScoringConfig seeded', { version: 1, factors: Object.keys(DEFAULT_WEIGHTS).length });
}

// ── Seed: PromptTemplates ────────────────────────────────────────────────────

const PROMPT_SEEDS = [
  {
    name: 'lead_analysis_v1',
    type: 'analysis' as const,
    version: 1,
    status: 'active' as const,
    generatedBy: 'system' as const,
    template: `Analyse this business website and identify automation / digital transformation opportunities.

Business: {businessName}
Domain: {domain}
Industry: {industry}
CMS detected: {cms}
Tech stack: {techStack}
Performance score: {performanceScore}/100
Automation level detected: {automationLevel}

Website HTML snippet (first 2000 chars):
{htmlSnippet}

Return a JSON object with EXACTLY these keys:
- detectedPains: string[] (max 5 specific pain points this business likely has)
- primaryPain: string (the single most compelling pain point)
- pitchAngle: string (1-2 sentence pitch angle targeting this specific business)
- confidenceScore: number (0.0–1.0, how confident you are this is a good prospect)
- automationLevel: "none"|"basic"|"moderate"|"advanced"
- automationSignals: string[] (max 5 specific signals you detected)`,
  },
  {
    name: 'batch_analysis_v1',
    type: 'batch_analysis' as const,
    version: 1,
    status: 'active' as const,
    generatedBy: 'system' as const,
    template: `Analyse these {count} business leads and identify their primary automation pain point.

Leads JSON:
{leadsJson}

Return a JSON array of {count} objects (same order as input), each with:
- id: string (the lead id from input)
- primaryPain: string (main pain point)
- confidenceScore: number (0.0–1.0)
- automationLevel: "none"|"basic"|"moderate"|"advanced"`,
  },
  {
    name: 'outreach_email_v1',
    type: 'outreach_email' as const,
    version: 1,
    status: 'active' as const,
    generatedBy: 'system' as const,
    template: `Write a short B2B cold email for this business.

Business: {businessName} ({domain})
Industry: {industry}
Primary pain point: {primaryPain}
Pitch angle: {pitchAngle}

Rules:
- Subject line: personalised, under 60 chars, no clickbait
- Body: 3 short paragraphs max (opener referencing their specific situation, value proposition, soft CTA)
- Tone: professional but conversational, no buzzwords
- DO NOT use "I hope this email finds you well" or similar openers
- Total body under 150 words

Return JSON with keys: subject (string), body (string)`,
  },
  {
    name: 'outreach_linkedin_v1',
    type: 'outreach_linkedin' as const,
    version: 1,
    status: 'active' as const,
    generatedBy: 'system' as const,
    template: `Write a LinkedIn connection request note for this business owner.

Business: {businessName} ({domain})
Industry: {industry}
Primary pain point: {primaryPain}

Rules:
- Max 300 characters (LinkedIn hard limit)
- Personalised to their specific situation
- No "I came across your profile" openers
- Soft — don't pitch on the connection request itself
- End with a question or reason to connect

Return JSON with key: body (string)`,
  },
  {
    name: 'prompt_optimizer_v1',
    type: 'analysis' as const,
    version: 1,
    status: 'active' as const,
    generatedBy: 'system' as const,
    template: `You are a prompt optimisation expert. Analyse the performance data for this prompt template and suggest an improved version.

Template name: {templateName}
Current template:
{currentTemplate}

Performance data (last {sampleSize} uses):
- Reply rate: {replyRate}%
- Conversion rate: {conversionRate}%
- Avg confidence score: {avgConfidence}

Examples of actual outcomes:
{outcomeExamples}

Provide an improved template that addresses the weaknesses. Keep the same {placeholder} variable syntax.

Return JSON with keys:
- analysis: string (what's weak about the current template)
- improvedTemplate: string (the new template text)
- expectedImprovement: string (what you expect to improve and why)`,
  },
];

async function seedPromptTemplates(): Promise<void> {
  let seeded = 0;
  for (const seed of PROMPT_SEEDS) {
    const exists = await PromptTemplate.findOne({ name: seed.name, version: seed.version });
    if (exists) continue;
    await PromptTemplate.create(seed);
    seeded++;
  }
  if (seeded > 0) {
    logger.info(`PromptTemplates seeded`, { count: seeded });
  } else {
    logger.info('PromptTemplates seed skipped — all templates already exist');
  }
}

// ── Seed: Admin user ─────────────────────────────────────────────────────────

async function seedAdminUser(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@hydrafox.local';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'HydraFox2025!';

  const existing = await User.findOne({ email: adminEmail });
  if (existing) {
    logger.info('Admin user seed skipped — user already exists', { email: adminEmail });
    return;
  }

  const passwordHash = await hashPassword(adminPassword);
  await User.create({
    email: adminEmail,
    passwordHash,
    name: 'Admin',
    role: 'admin',
    active: true,
  });
  logger.info('Admin user seeded', { email: adminEmail });
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runSeed(): Promise<void> {
  logger.info('Running seed...');
  await seedScoringConfig();
  await seedPromptTemplates();
  await seedAdminUser();
  logger.info('Seed complete.');
}

// Run directly if called as a script
if (require.main === module || process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  connectDB()
    .then(() => runSeed())
    .then(() => disconnectDB())
    .then(() => process.exit(0))
    .catch((err: Error) => {
      logger.error('Seed failed', { error: err.message });
      process.exit(1);
    });
}
