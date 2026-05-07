/**
 * AIService — all Claude interactions go through guardedAICall().
 *
 * Routing rules (from spec):
 *  - HOT leads  → gpt-4o        (OpenAI — best quality, higher cost)
 *  - WARM batch → deepseek-chat  (DeepSeek — 60-80% cost reduction)
 *
 * Prompt text is loaded from DB (promptTemplates collection) — never hardcoded here.
 */

import crypto from 'crypto';
import { guardedAICall, MODEL_PRIMARY, MODEL_SECONDARY } from './guardedAICall';
import { PromptTemplate } from '../models/promptTemplate.model';
import { IEnrichment } from '../models/enrichment.model';
import { ILead } from '../models/lead.model';
import { logger } from '../lib/logger';

export interface LeadAnalysisResult {
  detectedPains: string[];
  primaryPain: string;
  pitchAngle: string;
  confidenceScore: number;
  automationLevel: 'none' | 'basic' | 'moderate' | 'advanced';
  automationSignals: string[];
}

export interface OutreachResult {
  subject?: string;
  body: string;
  channel: 'email' | 'linkedin';
  promptTemplateId: string;
}

/** Load the active prompt template for a given type, with optional industry filter */
async function loadPrompt(
  type: string,
  industry?: string,
): Promise<{ template: string; id: string }> {
  // Try industry-specific first, fall back to generic
  const query = industry
    ? { type, status: 'active', $or: [{ targetIndustry: industry }, { targetIndustry: null }] }
    : { type, status: 'active' };

  const doc = await PromptTemplate.findOne(query)
    .sort({ replyRate: -1, _id: -1 })
    .lean();

  if (!doc) {
    throw new Error(`No active prompt template found for type="${type}"`);
  }

  return { template: doc.template, id: String(doc._id) };
}

/** Interpolate {placeholder} variables in a template string */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/** Build a deterministic cache key from prompt + inputs */
function buildCacheKey(type: string, input: string): string {
  return crypto.createHash('sha256').update(`${type}:${input}`).digest('hex');
}

export class AIService {
  /**
   * Analyse a single HOT lead website — uses Sonnet for quality.
   * Returns pain points, pitch angle, confidence score.
   */
  async analyseHotLead(
    lead: Pick<ILead, '_id' | 'businessName' | 'domain' | 'industry'>,
    enrichment: Pick<IEnrichment, 'techStack' | 'cms' | 'performanceScore' | 'automationLevel' | 'detectedPains' | 'rawHtmlSnapshot'>,
  ): Promise<LeadAnalysisResult> {
    const { template } = await loadPrompt('analysis', lead.industry);

    const userPrompt = interpolate(template, {
      businessName: lead.businessName,
      domain: lead.domain,
      industry: lead.industry ?? 'unknown',
      cms: enrichment.cms,
      techStack: enrichment.techStack.join(', ') || 'none detected',
      performanceScore: String(enrichment.performanceScore),
      automationLevel: enrichment.automationLevel,
      htmlSnippet: (enrichment.rawHtmlSnapshot ?? '').slice(0, 2000),
    });

    const systemPrompt = `You are an expert B2B sales analyst. Analyse the provided business website data and identify automation/digital transformation opportunities.
Return ONLY a valid JSON object with these exact keys: detectedPains (array of strings, max 5), primaryPain (string), pitchAngle (string), confidenceScore (0.0-1.0), automationLevel (none|basic|moderate|advanced), automationSignals (array of strings, max 5).
No markdown fences, no explanation — raw JSON only.`;

    const cacheKey = buildCacheKey('analysis', `${lead.domain}:${enrichment.performanceScore}:${enrichment.cms}`);

    const result = await guardedAICall({
      model: MODEL_PRIMARY,
      systemPrompt,
      userPrompt,
      purpose: 'lead_analysis',
      leadId: String(lead._id),
      cacheKey,
      maxTokens: 512,
    });

    try {
      const parsed = JSON.parse(result.content) as LeadAnalysisResult;
      return parsed;
    } catch {
      logger.error('AIService.analyseHotLead: failed to parse JSON response', {
        leadId: String(lead._id),
        raw: result.content.slice(0, 200),
      });
      throw new Error('AI_PARSE_ERROR: analysis response was not valid JSON');
    }
  }

  /**
   * Batch-analyse an array of WARM leads — uses Haiku for cost efficiency.
   * Returns partial analysis (pain + confidence only, no full pitch).
   */
  async batchAnalyseWarmLeads(
    leads: Array<{
      lead: Pick<ILead, '_id' | 'businessName' | 'domain' | 'industry'>;
      enrichment: Pick<IEnrichment, 'cms' | 'performanceScore' | 'automationLevel'>;
    }>,
  ): Promise<Map<string, Pick<LeadAnalysisResult, 'primaryPain' | 'confidenceScore' | 'automationLevel'>>> {
    const { template } = await loadPrompt('batch_analysis');

    const payload = leads.map(({ lead, enrichment }) => ({
      id: String(lead._id),
      domain: lead.domain,
      industry: lead.industry ?? 'unknown',
      cms: enrichment.cms,
      perf: enrichment.performanceScore,
      automation: enrichment.automationLevel,
    }));

    const userPrompt = interpolate(template, {
      leadsJson: JSON.stringify(payload, null, 2),
      count: String(leads.length),
    });

    const systemPrompt = `You are a B2B sales analyst. For each lead in the JSON array, return a JSON array of objects with keys: id, primaryPain (string), confidenceScore (0.0-1.0), automationLevel (none|basic|moderate|advanced).
Same array length as input, same order. Raw JSON array only — no markdown, no explanation.`;

    const cacheKey = buildCacheKey(
      'batch',
      payload.map(p => `${p.domain}:${p.automation}`).join('|'),
    );

    const result = await guardedAICall({
      model: MODEL_SECONDARY,
      systemPrompt,
      userPrompt,
      purpose: 'batch_analysis',
      cacheKey,
      maxTokens: leads.length * 80,
    });

    const out = new Map<string, Pick<LeadAnalysisResult, 'primaryPain' | 'confidenceScore' | 'automationLevel'>>();

    try {
      const parsed = JSON.parse(result.content) as Array<{
        id: string;
        primaryPain: string;
        confidenceScore: number;
        automationLevel: 'none' | 'basic' | 'moderate' | 'advanced';
      }>;
      for (const item of parsed) {
        out.set(item.id, {
          primaryPain: item.primaryPain,
          confidenceScore: item.confidenceScore,
          automationLevel: item.automationLevel,
        });
      }
    } catch {
      logger.error('AIService.batchAnalyseWarmLeads: failed to parse JSON response', {
        raw: result.content.slice(0, 200),
      });
    }

    return out;
  }

  /**
   * Generate an outreach message (email or LinkedIn) for a lead.
   * Uses MODEL_PRIMARY (gpt-4o) for HOT, MODEL_SECONDARY (deepseek-chat) for WARM.
   */
  async generateOutreach(
    lead: Pick<ILead, '_id' | 'businessName' | 'domain' | 'industry' | 'opportunityLevel'>,
    analysis: Pick<LeadAnalysisResult, 'primaryPain' | 'pitchAngle'>,
    channel: 'email' | 'linkedin',
  ): Promise<OutreachResult> {
    const promptType = channel === 'email' ? 'outreach_email' : 'outreach_linkedin';
    const { template, id: promptTemplateId } = await loadPrompt(promptType, lead.industry);

    const userPrompt = interpolate(template, {
      businessName: lead.businessName,
      domain: lead.domain,
      industry: lead.industry ?? 'unknown',
      primaryPain: analysis.primaryPain,
      pitchAngle: analysis.pitchAngle ?? 'digital transformation opportunity',
      agencyName: process.env.AGENCY_NAME ?? 'Our Agency',
      offerSummary: process.env.OFFER_SUMMARY ?? 'We help local businesses grow online',
    });

    const systemPrompt = channel === 'email'
      ? `You are an expert B2B cold email copywriter. Write a short, personalised cold email. Return JSON with keys: subject (string), body (string). Raw JSON only.`
      : `You are an expert LinkedIn outreach copywriter. Write a short personalised connection request note (max 300 chars). Return JSON with key: body (string). Raw JSON only.`;

    const model = lead.opportunityLevel === 'high' ? MODEL_PRIMARY : MODEL_SECONDARY;

    const cacheKey = buildCacheKey(
      `outreach_${channel}`,
      `${lead.domain}:${analysis.primaryPain}`,
    );

    const result = await guardedAICall({
      model,
      systemPrompt,
      userPrompt,
      purpose: 'outreach_gen',
      leadId: String(lead._id),
      cacheKey,
      maxTokens: 512,
    });

    try {
      const parsed = JSON.parse(result.content) as { subject?: string; body: string };
      return { ...parsed, channel, promptTemplateId };
    } catch {
      logger.error('AIService.generateOutreach: failed to parse JSON response', {
        leadId: String(lead._id),
        raw: result.content.slice(0, 200),
      });
      throw new Error('AI_PARSE_ERROR: outreach response was not valid JSON');
    }
  }
}

export const aiService = new AIService();
