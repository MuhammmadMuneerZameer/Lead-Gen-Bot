import crypto from 'crypto';

/**
 * SHA256(domain+businessName) — checked before every lead write.
 * Lowercases both inputs to ensure case-insensitive deduplication.
 */
export function generateFingerprint(domain: string, businessName: string): string {
  const normalized = `${domain.toLowerCase().trim()}${businessName.toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
