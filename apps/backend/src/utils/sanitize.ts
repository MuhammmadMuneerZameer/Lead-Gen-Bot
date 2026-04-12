/**
 * Input sanitization utilities.
 * All scraped data passes through these before touching MongoDB.
 */

/** Strip protocol, www, trailing slash, lowercase. Returns bare domain. */
export function sanitizeDomain(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\?.*$/, '');
}

/** Normalize to full URL with protocol. */
export function sanitizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Lowercase and validate email format. Returns empty string if invalid. */
export function sanitizeEmail(input: string): string {
  const lower = input.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(lower) ? lower : '';
}

/** Attempt E.164 formatting. Returns original string if cannot determine. */
export function sanitizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`; // assume US if 10 digits
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 8) return `+${digits}`;
  return input.trim();
}

/** Trim and cap string length. */
export function sanitizeString(input: string, maxLength = 500): string {
  return input.trim().slice(0, maxLength);
}

/** Normalize business name — trim, collapse whitespace. */
export function sanitizeBusinessName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, 200);
}
