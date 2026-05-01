/**
 * Pure social-media detection utilities — no I/O, no Playwright dependency.
 * Imported by both enrichment.service.ts and unit tests.
 */

export interface SocialDetectionResult {
  links: string[];
  // 'high'       : URL regex or meta tags found explicit links (OR all layers confirmed none)
  // 'medium'     : footer-only match
  // 'low'        : only bare-domain hints (could be tracking pixel / CDN reference)
  // 'unverified' : site had errors — absence cannot be trusted
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  layers: string[];
}

const SOCIAL_URL_PATTERNS: Record<string, RegExp> = {
  'facebook.com':  /https?:\/\/(www\.)?facebook\.com\/(?!sharer|share|login|pg|pages\/create)[a-zA-Z0-9._\-/]+/gi,
  'instagram.com': /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._\-]+\/?/gi,
  'linkedin.com':  /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9_\-]+/gi,
  'twitter.com':   /https?:\/\/(www\.)?twitter\.com\/[a-zA-Z0-9_]+/gi,
  'x.com':         /https?:\/\/(www\.)?x\.com\/[a-zA-Z0-9_]+/gi,
  'tiktok.com':    /https?:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9._\-]+/gi,
  'youtube.com':   /https?:\/\/(www\.)?youtube\.com\/(channel|user|c|@)[a-zA-Z0-9_\-]+/gi,
};

export const SOCIAL_BARE_DOMAINS = [
  'instagram.com', 'facebook.com', 'twitter.com', 'x.com',
  'linkedin.com', 'tiktok.com', 'youtube.com',
];

/** Layer 1: explicit social URLs anywhere in HTML (strongest signal) */
export function extractSocialsViaUrlRegex(html: string): string[] {
  const found: string[] = [];
  for (const regex of Object.values(SOCIAL_URL_PATTERNS)) {
    const matches = html.match(new RegExp(regex.source, 'gi')) ?? [];
    found.push(...matches.slice(0, 2));
  }
  return [...new Set(found)];
}

/** Layer 2: Open Graph / Twitter Card meta tags */
export function extractSocialsFromMeta(html: string): string[] {
  const found: string[] = [];
  const reA = /<meta[^>]+(?:property|name)=["'][^"']*(?:see_also|twitter:site|twitter:creator)[^"']*["'][^>]*content=["']([^"']+)["']/gi;
  const reB = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'][^"']*(?:see_also|twitter:site|twitter:creator)[^"']*["']/gi;
  for (const re of [reA, reB]) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(html)) !== null) {
      const val = m[1].trim();
      if (SOCIAL_BARE_DOMAINS.some(d => val.includes(d)) || val.startsWith('@')) {
        found.push(val);
      }
    }
  }
  return [...new Set(found)];
}

/** Layer 3: social URLs specifically inside the <footer> element */
export function extractSocialsFromFooter(html: string): string[] {
  const match = html.match(/<footer[\s\S]*?<\/footer>/i);
  if (!match) return [];
  return extractSocialsViaUrlRegex(match[0]);
}

/** Layer 4: bare domain mentions — scripts, JSON-LD, data attrs, iframes (weakest) */
export function extractSocialsFromBareDomain(html: string, alreadyFound: string[]): string[] {
  const found: string[] = [];
  for (const domain of SOCIAL_BARE_DOMAINS) {
    if (html.includes(domain) && !alreadyFound.some(s => s.includes(domain))) {
      found.push(domain);
    }
  }
  return found;
}

/** Full multi-layer social detection with confidence scoring */
export function extractSocialsWithConfidence(html: string): SocialDetectionResult {
  const layers: string[] = [];
  let links: string[] = [];

  const fromRegex = extractSocialsViaUrlRegex(html);
  if (fromRegex.length > 0) { layers.push('url_regex'); links.push(...fromRegex); }

  const fromMeta = extractSocialsFromMeta(html);
  if (fromMeta.length > 0) { layers.push('meta_tags'); links.push(...fromMeta); }

  const fromFooter = extractSocialsFromFooter(html);
  if (fromFooter.length > 0) { layers.push('footer'); links.push(...fromFooter); }

  links = [...new Set(links)];

  const fromBare = extractSocialsFromBareDomain(html, links);
  if (fromBare.length > 0) { layers.push('bare_domain'); links.push(...fromBare); }

  links = [...new Set(links)].slice(0, 8);

  let confidence: SocialDetectionResult['confidence'];
  if (layers.includes('url_regex') || layers.includes('meta_tags')) {
    confidence = 'high';
  } else if (layers.includes('footer')) {
    confidence = 'medium';
  } else if (layers.includes('bare_domain')) {
    confidence = 'low';
  } else {
    confidence = 'high'; // all strong layers confirmed nothing — absence is reliable
  }

  return { links, confidence, layers };
}

/** Backward-compatible wrapper */
export function extractSocials(html: string): string[] {
  return extractSocialsWithConfidence(html).links;
}
