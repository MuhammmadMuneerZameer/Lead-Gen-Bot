/**
 * guardedAICall — wraps EVERY Claude API call.
 *
 * Responsibilities:
 *  1. Route to Sonnet (HOT leads / complex) vs Haiku (WARM batch / cheap)
 *  2. Check 4-layer cache before calling the API
 *  3. Log cost to CostLedger after every successful call
 *  4. Abort if daily budget is exceeded (reads from costGuard.worker)
 *  5. Catch and log API errors without crashing callers
 *
 * ALL Claude API calls in HydraFox MUST go through this function — no exceptions.
 */

import Anthropic from '@anthropic-ai/sdk';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { CostLedger, calculateCost, AIModel, AICallPurpose } from '../models/costLedger.model';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODEL_SONNET: AIModel = 'claude-sonnet-4-20250514';
export const MODEL_HAIKU: AIModel = 'claude-haiku-4-5-20251001';

// Daily spend ceiling loaded from env (default $5/day)
const DAILY_BUDGET_USD = parseFloat(process.env.AI_DAILY_BUDGET_USD ?? '5');
const COST_DAILY_KEY = () => `ai:cost:${new Date().toISOString().slice(0, 10)}`;
const CACHE_TTL = 3600 * 24; // 24h cache for identical prompts

export interface GuardedCallOptions {
  model: AIModel;
  systemPrompt: string;
  userPrompt: string;
  purpose: AICallPurpose;
  leadId?: string;
  /** SHA256 cache key — pass to skip identical calls within 24h */
  cacheKey?: string;
  maxTokens?: number;
}

export interface GuardedCallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  cacheHit: boolean;
  model: AIModel;
}

/**
 * Check if daily AI spend has exceeded the budget cap.
 * Throws if over budget — callers should catch and degrade gracefully.
 */
async function assertBudgetOk(): Promise<void> {
  const key = COST_DAILY_KEY();
  const spent = parseFloat((await redis.get(key)) ?? '0');
  if (spent >= DAILY_BUDGET_USD) {
    logger.warn('Daily AI budget exceeded', { spent, limit: DAILY_BUDGET_USD });
    throw new Error(`AI_BUDGET_EXCEEDED: $${spent.toFixed(4)} >= $${DAILY_BUDGET_USD} daily limit`);
  }
}

/**
 * Increment the Redis daily cost counter and persist to CostLedger.
 */
async function recordCost(
  model: AIModel,
  purpose: AICallPurpose,
  inputTokens: number,
  outputTokens: number,
  cacheHit: boolean,
  leadId?: string,
): Promise<number> {
  const costUSD = calculateCost(model, inputTokens, outputTokens, cacheHit);

  const key = COST_DAILY_KEY();
  await redis.incrbyfloat(key, costUSD);
  await redis.expire(key, 3600 * 25); // keep for 25h so next day can read yesterday

  // Persist to MongoDB asynchronously — don't block the caller
  CostLedger.create({
    aiModel: model,
    leadId: leadId ?? undefined,
    purpose,
    inputTokens,
    outputTokens,
    costUSD,
    cacheHit,
    timestamp: new Date(),
  }).catch((err: Error) => {
    logger.error('Failed to write CostLedger entry', { error: err.message });
  });

  return costUSD;
}

/**
 * The one and only function that may call the Claude API in HydraFox.
 */
export async function guardedAICall(opts: GuardedCallOptions): Promise<GuardedCallResult> {
  const {
    model,
    systemPrompt,
    userPrompt,
    purpose,
    leadId,
    cacheKey,
    maxTokens = 1024,
  } = opts;

  // ── 1. Cache check ────────────────────────────────────────────────────────
  if (cacheKey) {
    const redisCacheKey = `ai:cache:${cacheKey}`;
    const cached = await redis.get(redisCacheKey);
    if (cached) {
      logger.debug('guardedAICall cache hit', { cacheKey: cacheKey.slice(0, 12), purpose });
      const parsed = JSON.parse(cached) as GuardedCallResult;
      // Still record a zero-cost cache hit for audit trail
      await recordCost(model, purpose, 0, 0, true, leadId);
      return { ...parsed, cacheHit: true };
    }
  }

  // ── 2. Budget check ───────────────────────────────────────────────────────
  await assertBudgetOk();

  // ── 3. API call ───────────────────────────────────────────────────────────
  logger.debug('guardedAICall → Claude API', { model, purpose, leadId });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Claude API call failed', { model, purpose, error: msg });
    throw new Error(`CLAUDE_API_ERROR: ${msg}`);
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const content = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  // ── 4. Record cost ────────────────────────────────────────────────────────
  const costUSD = await recordCost(model, purpose, inputTokens, outputTokens, false, leadId);

  const result: GuardedCallResult = {
    content,
    inputTokens,
    outputTokens,
    costUSD,
    cacheHit: false,
    model,
  };

  // ── 5. Populate cache ─────────────────────────────────────────────────────
  if (cacheKey) {
    const redisCacheKey = `ai:cache:${cacheKey}`;
    await redis.setex(redisCacheKey, CACHE_TTL, JSON.stringify(result));
  }

  logger.info('guardedAICall complete', {
    model,
    purpose,
    inputTokens,
    outputTokens,
    costUSD: costUSD.toFixed(6),
    leadId,
  });

  return result;
}

/**
 * Convenience: get today's total AI spend in USD.
 */
export async function getDailySpend(): Promise<number> {
  const key = COST_DAILY_KEY();
  return parseFloat((await redis.get(key)) ?? '0');
}
