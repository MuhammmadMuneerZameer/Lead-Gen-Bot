/**
 * Input sanitization utilities for HydraFox v3.0
 */

export function sanitizeDomain(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\?.*$/, '');
}

export function sanitizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function sanitizeEmail(input: string): string {
  const lower = input.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(lower) ? lower : '';
}

export function sanitizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 8) return `+${digits}`;
  return input.trim();
}

export function sanitizeBusinessName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, 200);
}
