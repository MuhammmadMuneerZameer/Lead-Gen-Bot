import { Lead } from '../models/lead.model';
import { generateFingerprint } from './fingerprint';
import { sanitizeDomain, sanitizeBusinessName } from './sanitize';
import { logger } from '../lib/logger';

export interface LeadInput {
  domain: string;
  businessName: string;
  source: string;
  sourceId?: string;
  [key: string]: unknown;
}

/**
 * Check if a fingerprint already exists in the DB.
 * MUST be called before every lead write.
 */
export async function isDuplicate(fingerprint: string): Promise<boolean> {
  const existing = await Lead.findOne({ fingerprint }).select('_id').lean();
  return !!existing;
}

/**
 * Either update the existing lead's metadata (last_seen, source)
 * or create a new one. Never creates a duplicate.
 * Returns { lead, isNew }.
 */
export async function mergeOrCreate(
  leadData: LeadInput,
  additionalFields: Record<string, unknown> = {},
): Promise<{ lead: InstanceType<typeof Lead>; isNew: boolean }> {
  const domain = sanitizeDomain(leadData.domain);
  const businessName = sanitizeBusinessName(leadData.businessName);
  const fingerprint = generateFingerprint(domain, businessName);

  const existing = await Lead.findOne({ fingerprint });

  if (existing) {
    // Update metadata on re-scrape — do NOT create duplicate
    existing.set('lastSeenAt', new Date());
    if (leadData.source && !existing.get('tags')?.includes(`source:${leadData.source}`)) {
      const tags: string[] = existing.get('tags') ?? [];
      tags.push(`source:${leadData.source}`);
      existing.set('tags', tags);
    }
    await existing.save();
    logger.debug('Duplicate lead merged', { domain, fingerprint: fingerprint.slice(0, 8) });
    return { lead: existing, isNew: false };
  }

  const lead = new Lead({
    ...additionalFields,
    domain,
    businessName,
    fingerprint,
    source: leadData.source,
    sourceId: leadData.sourceId,
  });
  await lead.save();
  logger.debug('New lead created', { domain, fingerprint: fingerprint.slice(0, 8) });
  return { lead, isNew: true };
}
