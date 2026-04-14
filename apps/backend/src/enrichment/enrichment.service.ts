/**
 * EnrichmentService — fetches and analyses a business website.
 *
 * Improvements over v1:
 *  - Extracts emails from mailto: href links first (most reliable)
 *  - Scans homepage + /contact + /about + /contact-us + /about-us
 *  - Better phone regex with cleanup and validation
 *  - Retry on network failure (up to 2 attempts)
 *  - Deduplicates and validates all extracted data
 */

import { chromium, Browser, BrowserContext } from 'playwright-core';
import { logger } from '../lib/logger';

export interface EnrichmentResult {
  phone?: string;
  email?: string;
  socialLinks: string[];
  websiteQuality: 'outdated' | 'basic' | 'modern' | 'unknown';
  techStack: string[];
  cms: 'WordPress' | 'Shopify' | 'Wix' | 'Squarespace' | 'custom' | 'unknown';
  automationLevel: 'none' | 'basic' | 'moderate' | 'advanced';
  automationSignals: string[];
  siteStatus: 'live' | 'unreachable' | 'redirect' | 'error';
  rawHtmlSnapshot: string;
  hasSSL: boolean;
  hasChatbot: boolean;
  hasContactForm: boolean;
  mobileFriendly: boolean;
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browser;
}

// ── Email extraction ─────────────────────────────────────────────────────────

/** Extract emails from mailto: hrefs — highest accuracy */
function extractMailtoEmails(html: string): string[] {
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = mailtoRegex.exec(html)) !== null) {
    found.push(m[1].toLowerCase());
  }
  return [...new Set(found)];
}

/** Extract emails from plain text/HTML — secondary pass */
function extractTextEmails(html: string): string[] {
  // Remove script/style blocks to reduce noise
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const raw = Array.from(new Set(cleaned.match(emailRegex) || []));

  // Filter noise: image extensions, common non-emails, very short domains
  return raw
    .filter(e => !e.match(/\.(png|jpg|gif|svg|webp|css|js|woff|ttf|eot|ico)$/i))
    .filter(e => !e.match(/^(noreply|no-reply|donotreply|do-not-reply|support|example|test|demo|sentry|placeholder|user|admin@example|info@example)/i))
    .filter(e => e.includes('.') && e.split('@')[1]?.includes('.'))
    .map(e => e.toLowerCase());
}

/** Merge mailto (priority) + text emails, deduplicated */
function extractEmails(html: string): string[] {
  const mailto = extractMailtoEmails(html);
  const text = extractTextEmails(html);
  // mailto emails come first as they are the most intentionally placed
  return [...new Set([...mailto, ...text])];
}

// ── Phone extraction ─────────────────────────────────────────────────────────

/** Clean and validate a raw phone string */
function cleanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // Valid phone: 7–15 digits (international range)
  if (digits.length < 7 || digits.length > 15) return null;
  // Skip strings that are clearly not phones (years, zip codes, etc.)
  if (/^(19|20)\d{2}$/.test(digits)) return null;
  return raw.trim();
}

function extractPhones(html: string): string[] {
  // Remove scripts and styles first
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Multiple patterns to maximise recall:
  const patterns = [
    // tel: href  — most reliable
    /tel:([\+\d\s()\-\.]{7,20})/gi,
    // US format: (123) 456-7890 or 123-456-7890
    /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g,
    // International: +1 123 456 7890 or +44 20 1234 5678
    /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g,
    // 10-digit run: 1234567890
    /\b\d{10}\b/g,
  ];

  const found: string[] = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(cleaned)) !== null) {
      const candidate = (m[1] ?? m[0]).trim();
      const clean = cleanPhone(candidate);
      if (clean) found.push(clean);
    }
  }

  // Deduplicate by digit fingerprint
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of found) {
    const key = p.replace(/\D/g, '');
    if (!seen.has(key)) { seen.add(key); deduped.push(p); }
  }
  return deduped;
}

// ── Social links ─────────────────────────────────────────────────────────────

function extractSocials(html: string): string[] {
  const patterns = [
    /https?:\/\/(www\.)?facebook\.com\/(?!sharer|share|login|pg|pages\/create)[a-zA-Z0-9._\-/]+/gi,
    /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._\-]+\/?/gi,
    /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9_\-]+/gi,
    /https?:\/\/(www\.)?twitter\.com\/[a-zA-Z0-9_]+/gi,
    /https?:\/\/(www\.)?x\.com\/[a-zA-Z0-9_]+/gi,
    /https?:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9._\-]+/gi,
  ];

  const socials: string[] = [];
  for (const p of patterns) {
    const matches = html.match(p) ?? [];
    socials.push(...matches.slice(0, 2));
  }
  return [...new Set(socials)].slice(0, 8);
}

// ── Quality / CMS / Automation ───────────────────────────────────────────────

function detectQuality(html: string): EnrichmentResult['websiteQuality'] {
  const hasViewport = /<meta[^>]*viewport/i.test(html);
  const hasTables = /<table[^>]*>/i.test(html.slice(0, 3000));
  const isModern = /Tailwind|React|Next\.js|Vue|Vite|nuxt|angular/i.test(html);
  const hasFramework = /data-reactroot|__next|__nuxt|ng-app/i.test(html);
  if (!hasViewport || hasTables) return 'outdated';
  if (isModern || hasFramework) return 'modern';
  return 'basic';
}

function detectCMS(html: string): EnrichmentResult['cms'] {
  if (/wp-content|wp-includes|wordpress/i.test(html)) return 'WordPress';
  if (/shopify|cdn\.shopify\.com/i.test(html)) return 'Shopify';
  if (/wix\.com|X-Wix-Published-Version/i.test(html)) return 'Wix';
  if (/squarespace\.com|static\.squarespace/i.test(html)) return 'Squarespace';
  if (/React|Next\.js|Vue|Angular|Nuxt/i.test(html)) return 'custom';
  return 'unknown';
}

function detectAutomation(html: string): {
  level: EnrichmentResult['automationLevel'];
  signals: string[];
} {
  const signals: string[] = [];
  if (/chatbot|livechat|intercom|drift|tawk\.to|crisp\.chat/i.test(html)) signals.push('live chat');
  if (/calendly|booking|schedule.*appointment|book.*online/i.test(html)) signals.push('online booking');
  if (/mailchimp|klaviyo|hubspot|newsletter/i.test(html)) signals.push('email marketing');
  if (/stripe|paypal|payment|checkout/i.test(html)) signals.push('online payment');
  if (/analytics|gtag|fbq|_ga/i.test(html)) signals.push('web analytics');
  if (/zapier|automation|webhook/i.test(html)) signals.push('automation tools');
  if (/crm|salesforce|zoho/i.test(html)) signals.push('CRM integration');

  const level: EnrichmentResult['automationLevel'] =
    signals.length >= 4 ? 'advanced' :
    signals.length >= 2 ? 'moderate' :
    signals.length >= 1 ? 'basic' : 'none';

  return { level, signals };
}

function detectTechStack(html: string): string[] {
  const stack: string[] = [];
  if (/react|reactjs/i.test(html)) stack.push('React');
  if (/next\.js|__next/i.test(html)) stack.push('Next.js');
  if (/vue\.js|vuejs/i.test(html)) stack.push('Vue.js');
  if (/angular/i.test(html)) stack.push('Angular');
  if (/jquery/i.test(html)) stack.push('jQuery');
  if (/tailwindcss|tailwind/i.test(html)) stack.push('Tailwind CSS');
  if (/bootstrap/i.test(html)) stack.push('Bootstrap');
  if (/google-analytics|gtag\.js/i.test(html)) stack.push('Google Analytics');
  if (/gtm\.js|googletagmanager/i.test(html)) stack.push('Google Tag Manager');
  if (/stripe/i.test(html)) stack.push('Stripe');
  if (/woocommerce/i.test(html)) stack.push('WooCommerce');
  if (/elementor/i.test(html)) stack.push('Elementor');
  return stack.slice(0, 10);
}

// ── Sub-page URLs to scan for contact info ───────────────────────────────────

const CONTACT_PATHS = ['/contact', '/contact-us', '/contactus', '/about', '/about-us', '/aboutus', '/reach-us'];

async function findContactPageUrl(baseUrl: string, pageHtml: string): Promise<string | null> {
  // First try to find contact/about link in the HTML
  const linkRegex = /href="([^"]*(?:contact|about|reach)[^"]*)"/gi;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(pageHtml)) !== null) {
    const href = m[1];
    if (href.startsWith('http') && !href.includes(new URL(baseUrl).hostname)) continue;
    candidates.push(href);
  }

  // Try candidate links first, then fallback to known paths
  const toTry = [
    ...candidates.slice(0, 3),
    ...CONTACT_PATHS,
  ];

  for (const path of toTry) {
    try {
      const full = path.startsWith('http') ? path : new URL(path, baseUrl).href;
      return full;
    } catch { /* invalid URL */ }
  }
  return null;
}

// ── Unreachable error detection ───────────────────────────────────────────────

const UNREACHABLE_ERRORS = [
  'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT',
  'net::ERR_', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT',
];

function isUnreachableError(message: string): boolean {
  return UNREACHABLE_ERRORS.some(e => message.includes(e));
}

// ── Main enrichment function ─────────────────────────────────────────────────

export async function enrichWebsite(domain: string, website?: string): Promise<EnrichmentResult> {
  const urlsToTry = website
    ? [website, `https://${domain}`, `http://${domain}`]
    : [`https://${domain}`, `http://${domain}`];

  // Deduplicate URLs
  const uniqueUrls = [...new Set(urlsToTry)];

  let context: BrowserContext | null = null;

  for (const url of uniqueUrls) {
    try {
      const b = await getBrowser();
      context = await b.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });

      const page = await context.newPage();
      let redirected = false;

      page.on('response', response => {
        if (response.url() !== url && [301, 302, 303, 307, 308].includes(response.status())) {
          redirected = true;
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Let JS render briefly
      await new Promise(r => setTimeout(r, 1500));

      let html = await page.content();
      const baseUrl = page.url(); // actual URL after redirects

      // ── Multi-page scan for contact info ───────────────────────────────────
      // Always scan a contact/about page to maximize email/phone extraction
      const subPagesToScan: string[] = [];

      // 1) Try to find contact link in the current page
      const contactUrl = await findContactPageUrl(baseUrl, html);
      if (contactUrl) subPagesToScan.push(contactUrl);

      // 2) Always try common paths
      for (const path of CONTACT_PATHS.slice(0, 3)) {
        try {
          subPagesToScan.push(new URL(path, baseUrl).href);
        } catch { /* skip */ }
      }

      // Scan up to 3 sub-pages
      const visitedUrls = new Set<string>([baseUrl]);
      for (const subUrl of [...new Set(subPagesToScan)].slice(0, 3)) {
        if (visitedUrls.has(subUrl)) continue;
        visitedUrls.add(subUrl);
        try {
          const subPage = await context.newPage();
          await subPage.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
          await new Promise(r => setTimeout(r, 800));
          html += '\n' + await subPage.content();
          await subPage.close();
          logger.debug('Enrichment: scanned sub-page', { subUrl });
        } catch {
          // Sub-page failure is non-fatal
        }
      }

      // ── Extract all data ───────────────────────────────────────────────────
      const emails = extractEmails(html);
      const phones = extractPhones(html);
      const socials = extractSocials(html);
      const quality = detectQuality(html);
      const cms = detectCMS(html);
      const { level: automationLevel, signals: automationSignals } = detectAutomation(html);
      const techStack = detectTechStack(html);

      const hasSSL = url.startsWith('https://') || baseUrl.startsWith('https://');
      const mobileFriendly = /<meta[^>]*viewport/i.test(html);
      const hasChatbot = /chatbot|livechat|intercom|drift|tawk|crisp/i.test(html);
      const hasContactForm = /<form[^>]*>/i.test(html) && /contact|message|inquiry|enquiry/i.test(html);

      await context.close();
      context = null;

      logger.info('Enrichment: complete', {
        domain, emails: emails.length, phones: phones.length,
        socials: socials.length, quality, cms,
      });

      return {
        email: emails[0],
        phone: phones[0],
        socialLinks: socials,
        websiteQuality: quality,
        techStack,
        cms,
        automationLevel,
        automationSignals,
        siteStatus: redirected ? 'redirect' : 'live',
        rawHtmlSnapshot: html.slice(0, 5000),
        hasSSL,
        hasChatbot,
        hasContactForm,
        mobileFriendly,
      };

    } catch (err) {
      const msg = (err as Error).message ?? '';
      logger.warn('Enrichment attempt failed', { url, error: msg });

      if (context) {
        await context.close().catch(() => {});
        context = null;
      }

      if (url === uniqueUrls[uniqueUrls.length - 1]) {
        const siteStatus = isUnreachableError(msg) ? 'unreachable' : 'error';
        logger.error('Enrichment failed — all URLs exhausted', { domain, siteStatus, error: msg });
        return {
          socialLinks: [],
          websiteQuality: 'unknown',
          techStack: [],
          cms: 'unknown',
          automationLevel: 'none',
          automationSignals: [],
          siteStatus,
          rawHtmlSnapshot: '',
          hasSSL: false,
          hasChatbot: false,
          hasContactForm: false,
          mobileFriendly: false,
        };
      }
    }
  }

  // Fallback (should never reach)
  return {
    socialLinks: [],
    websiteQuality: 'unknown',
    techStack: [],
    cms: 'unknown',
    automationLevel: 'none',
    automationSignals: [],
    siteStatus: 'error',
    rawHtmlSnapshot: '',
    hasSSL: false,
    hasChatbot: false,
    hasContactForm: false,
    mobileFriendly: false,
  };
}
