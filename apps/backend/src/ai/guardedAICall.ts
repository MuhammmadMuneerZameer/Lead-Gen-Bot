/**
 * guardedAICall — wraps EVERY AI API call.
 *
 * Routing rules:
 *  - HOT leads  → gpt-4o        (OpenAI — best quality)
 *  - WARM batch → deepseek-chat  (DeepSeek — very cheap, OpenAI-compatible)
 *
 * Prompt text is loaded from DB (promptTemplates collection) — never hardcoded here.
 */

import OpenAI from 'openai';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { CostLedger, calculateCost, AIModel, AICallPurpose } from '../models/costLedger.model';

// OpenAI client — HOT leads
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// DeepSeek client — WARM batch (OpenAI-compatible)
const deepseekClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export const MODEL_PRIMARY: AIModel = 'gpt-4o';       // OpenAI GPT-4o — HOT leads
export const MODEL_SECONDARY: AIModel = 'deepseek-chat'; // DeepSeek — WARM/batch leads

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
  await redis.expire(key, 3600 * 25);

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
 * The one and only function that may call the AI API in HydraFox.
 * Routes gpt-4o → OpenAI, deepseek-chat → DeepSeek.
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
      await recordCost(model, purpose, 0, 0, true, leadId);
      return { ...parsed, cacheHit: true };
    }
  }

  // ── 2. Budget check ───────────────────────────────────────────────────────
  await assertBudgetOk();

  // ── 3. API call ───────────────────────────────────────────────────────────
  const client = model === 'deepseek-chat' ? deepseekClient : openaiClient;
  logger.debug('guardedAICall → AI API', { model, purpose, leadId });

  let response: OpenAI.Chat.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature: 0,  // deterministic — maximises cache hit rate for identical prompts
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('AI API call failed', { model, purpose, error: msg });
    throw new Error(`AI_API_ERROR: ${msg}`);
  }

  const inputTokens  = response.usage?.prompt_tokens     ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const content      = response.choices[0]?.message?.content ?? '';

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
