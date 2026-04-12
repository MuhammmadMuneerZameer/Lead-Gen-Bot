/**
 * EnrichmentService — fetches and analyses a business website.
 *
 * Pipeline per lead:
 *  1. Playwright headless fetch (chromium)
 *  2. Wappalyzer-style tech detection from HTML/headers
 *  3. Synthetic performance score from response timing + HTML size
 *  4. SEO + quality signal extraction
 *  5. Returns a fully populated Enrichment document payload
 *
 * Browser instance is shared across concurrent jobs (one per process).
 */

import { chromium, Browser, BrowserContext } from 'playwright-core';
import { logger } from '../lib/logger';

export interface EnrichmentResult {
  techStack: string[];
  cms: 'WordPress' | 'Shopify' | 'Wix' | 'Squarespace' | 'custom' | 'unknown';
  performanceScore: number;
  seoScore: number;
  siteQualityScore: number;
  mobileFriendly: boolean;
  hasSSL: boolean;
  hasChatbot: boolean;
  hasBookingSystem: boolean;
  hasEcommerce: boolean;
  hasContactForm: boolean;
  automationLevel: 'none' | 'basic' | 'moderate' | 'advanced';
  automationSignals: string[];
  socialActivity: 'active' | 'inactive' | 'unknown';
  detectedPains: string[];
  rawHtmlSnapshot: string;
  siteStatus: 'live' | 'unreachable' | 'redirect' | 'error';
}

// ── Singleton browser management ─────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  logger.info('Playwright browser launched');
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Playwright browser closed');
  }
}

// ── Tech stack detection (Wappalyzer-style heuristics) ───────────────────────

interface TechSignature {
  name: string;
  patterns: RegExp[];
}

const TECH_SIGNATURES: TechSignature[] = [
  // CMS
  { name: 'WordPress', patterns: [/wp-content\//i, /wp-includes\//i, /wordpress/i] },
  { name: 'Shopify', patterns: [/shopify/i, /cdn\.shopify\.com/i, /myshopify\.com/i] },
  { name: 'Wix', patterns: [/wix\.com/i, /wixsite\.com/i, /wixstatic\.com/i] },
  { name: 'Squarespace', patterns: [/squarespace\.com/i, /sqspcdn\.com/i] },
  { name: 'Webflow', patterns: [/webflow\.com/i, /webflow\.io/i] },
  { name: 'GoDaddy Website Builder', patterns: [/godaddysites\.com/i, /godaddy/i] },
  // Booking / reservation
  { name: 'Calendly', patterns: [/calendly\.com/i] },
  { name: 'Acuity Scheduling', patterns: [/acuityscheduling\.com/i] },
  { name: 'Booksy', patterns: [/booksy\.com/i] },
  { name: 'OpenTable', patterns: [/opentable\.com/i] },
  { name: 'Mindbody', patterns: [/mindbodyonline\.com/i] },
  // Live chat / chatbots
  { name: 'Intercom', patterns: [/intercom\.com/i, /intercomcdn\.com/i] },
  { name: 'Drift', patterns: [/drift\.com/i] },
  { name: 'Crisp', patterns: [/crisp\.chat/i] },
  { name: 'LiveChat', patterns: [/livechatinc\.com/i] },
  { name: 'Tidio', patterns: [/tidio\.com/i] },
  { name: 'Zendesk', patterns: [/zendesk\.com/i] },
  // E-commerce signals
  { name: 'WooCommerce', patterns: [/woocommerce/i] },
  { name: 'BigCommerce', patterns: [/bigcommerce\.com/i] },
  { name: 'Stripe', patterns: [/stripe\.com/i, /js\.stripe\.com/i] },
  { name: 'PayPal', patterns: [/paypal\.com/i] },
  // Marketing automation
  { name: 'HubSpot', patterns: [/hubspot\.com/i, /hs-scripts\.com/i] },
  { name: 'Mailchimp', patterns: [/mailchimp\.com/i, /chimpified\.com/i] },
  { name: 'ActiveCampaign', patterns: [/activecampaign\.com/i] },
  { name: 'Klaviyo', patterns: [/klaviyo\.com/i] },
  // Analytics
  { name: 'Google Analytics', patterns: [/google-analytics\.com/i, /gtag\/js/i, /ga\('create'/i] },
  { name: 'Facebook Pixel', patterns: [/connect\.facebook\.net/i, /fbq\(/i] },
  // Misc
  { name: 'React', patterns: [/react\.production\.min\.js/i, /__NEXT_DATA__/i, /data-reactroot/i] },
  { name: 'Vue.js', patterns: [/vue\.min\.js/i, /data-v-/i] },
  { name: 'jQuery', patterns: [/jquery\.min\.js/i, /\$\.ajax/i] },
  { name: 'Bootstrap', patterns: [/bootstrap\.min\.css/i, /class="container/i] },
  { name: 'Tailwind CSS', patterns: [/tailwindcss/i] },
];

const CMS_PRIORITY: Array<'WordPress' | 'Shopify' | 'Wix' | 'Squarespace'> = ['WordPress', 'Shopify', 'Wix', 'Squarespace'];

function detectTechStack(html: string, headers: Record<string, string>): {
  techStack: string[];
  cms: EnrichmentResult['cms'];
} {
  const combined = html + JSON.stringify(headers);
  const detected = TECH_SIGNATURES.filter(sig =>
    sig.patterns.some(p => p.test(combined)),
  ).map(sig => sig.name);

  const cms = CMS_PRIORITY.find(c => detected.includes(c)) ?? 'custom';
  return { techStack: detected.slice(0, 10), cms };
}

// ── Signal extractors ────────────────────────────────────────────────────────

function detectBookingSystem(html: string, techStack: string[]): boolean {
  const bookingKeywords = /book\s+(now|online|appointment|a\s+call)|schedule|reserve|appointment|calendar/i;
  const bookingTech = ['Calendly', 'Acuity Scheduling', 'Booksy', 'OpenTable', 'Mindbody'];
  return bookingKeywords.test(html) || bookingTech.some(t => techStack.includes(t));
}

function detectChatbot(html: string, techStack: string[]): boolean {
  const chatTech = ['Intercom', 'Drift', 'Crisp', 'LiveChat', 'Tidio', 'Zendesk'];
  const chatKeywords = /live\s?chat|chat\s?bot|chat\s?with\s+us/i;
  return chatTech.some(t => techStack.includes(t)) || chatKeywords.test(html);
}

function detectContactForm(html: string): boolean {
  return /<form[^>]*>/i.test(html) && /contact|email|message|enquir/i.test(html);
}

function detectEcommerce(html: string, techStack: string[]): boolean {
  const ecomTech = ['WooCommerce', 'BigCommerce', 'Shopify', 'Stripe', 'PayPal'];
  const ecomKeywords = /add to cart|buy now|checkout|shopping cart/i;
  return ecomTech.some(t => techStack.includes(t)) || ecomKeywords.test(html);
}

function detectAutomationLevel(techStack: string[]): {
  level: EnrichmentResult['automationLevel'];
  signals: string[];
} {
  const marketingAutomation = ['HubSpot', 'ActiveCampaign', 'Klaviyo', 'Mailchimp'];
  const bookingTools = ['Calendly', 'Acuity Scheduling', 'Booksy', 'OpenTable', 'Mindbody'];
  const chatTools = ['Intercom', 'Drift', 'Crisp', 'LiveChat', 'Tidio'];

  const signals: string[] = [];
  const detectedMarketing = marketingAutomation.filter(t => techStack.includes(t));
  const detectedBooking = bookingTools.filter(t => techStack.includes(t));
  const detectedChat = chatTools.filter(t => techStack.includes(t));

  signals.push(...detectedMarketing, ...detectedBooking, ...detectedChat);

  const score = detectedMarketing.length * 2 + detectedBooking.length + detectedChat.length;

  let level: EnrichmentResult['automationLevel'] = 'none';
  if (score >= 5) level = 'advanced';
  else if (score >= 3) level = 'moderate';
  else if (score >= 1) level = 'basic';

  return { level, signals: signals.slice(0, 5) };
}

function detectPains(html: string, cms: string, automationLevel: string): string[] {
  const pains: string[] = [];
  if (automationLevel === 'none') pains.push('No marketing automation detected');
  if (cms === 'Wix' || cms === 'Squarespace') pains.push(`Using ${cms} — likely no backend flexibility`);
  if (!/https/i.test(html.slice(0, 500))) pains.push('Possible SSL issues detected');
  if (!/<meta[^>]*viewport/i.test(html)) pains.push('Possibly not mobile-optimized');
  if (!/<meta[^>]*description/i.test(html)) pains.push('Missing meta description — poor SEO');
  if (html.length < 5000) pains.push('Very thin content — minimal web presence');
  return pains.slice(0, 5);
}

// ── Synthetic scoring ────────────────────────────────────────────────────────

function syntheticPerformanceScore(htmlBytes: number, loadMs: number): number {
  // Rough score: penalise large pages and slow loads
  const sizeScore = Math.max(0, 100 - Math.floor(htmlBytes / 10000) * 5);
  const speedScore = Math.max(0, 100 - Math.floor(loadMs / 500) * 10);
  return Math.round((sizeScore + speedScore) / 2);
}

function syntheticSeoScore(html: string): number {
  let score = 0;
  if (/<title>/i.test(html)) score += 20;
  if (/<meta[^>]*description/i.test(html)) score += 20;
  if (/<h1/i.test(html)) score += 20;
  if (/<meta[^>]*viewport/i.test(html)) score += 20;
  if (/canonical/i.test(html)) score += 20;
  return score;
}

function syntheticQualityScore(html: string, techStack: string[], hasSSL: boolean): number {
  let score = 0;
  if (hasSSL) score += 20;
  if (/<meta[^>]*viewport/i.test(html)) score += 15; // mobile
  if (techStack.includes('Google Analytics')) score += 10;
  if (html.length > 10000) score += 15; // content depth
  if (/<img[^>]*alt=/i.test(html)) score += 10; // accessibility
  if (techStack.length > 3) score += 10; // modern stack
  if (/<script[^>]*defer/i.test(html)) score += 10; // performance-conscious
  if (/<link[^>]*preload/i.test(html)) score += 10; // performance-conscious
  return Math.min(100, score);
}

// ── Main enrich function ─────────────────────────────────────────────────────

export async function enrichWebsite(domain: string, website?: string): Promise<EnrichmentResult> {
  const url = website ?? `https://${domain}`;
  const hasSSL = url.startsWith('https');

  let context: BrowserContext | null = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent: 'Mozilla/5.0 (compatible; HydraFoxBot/3.0; +https://hydrafox.io/bot)',
      viewport: { width: 1280, height: 800 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    const startMs = Date.now();

    let finalStatus: EnrichmentResult['siteStatus'] = 'live';
    const responseHeaders: Record<string, string> = {};

    page.on('response', (response) => {
      if (response.url() === url || response.url().startsWith(url.replace(/\/$/, ''))) {
        const status = response.status();
        if (status >= 400) finalStatus = 'error';
        Object.assign(responseHeaders, response.headers());
      }
    });

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response) {
        const status = response.status();
        if (status === 0 || status >= 500) finalStatus = 'unreachable';
        else if (status >= 300 && status < 400) finalStatus = 'redirect';
      }
    } catch {
      finalStatus = 'unreachable';
    }

    const loadMs = Date.now() - startMs;

    if (finalStatus === 'unreachable') {
      return {
        techStack: [],
        cms: 'unknown',
        performanceScore: 0,
        seoScore: 0,
        siteQualityScore: 0,
        mobileFriendly: false,
        hasSSL,
        hasChatbot: false,
        hasBookingSystem: false,
        hasEcommerce: false,
        hasContactForm: false,
        automationLevel: 'none',
        automationSignals: [],
        socialActivity: 'unknown',
        detectedPains: ['Site is unreachable'],
        rawHtmlSnapshot: '',
        siteStatus: 'unreachable',
      };
    }

    const html = await page.content();
    const rawHtmlSnapshot = html.slice(0, 5000);

    const { techStack, cms } = detectTechStack(html, responseHeaders);
    const hasChatbot = detectChatbot(html, techStack);
    const hasBookingSystem = detectBookingSystem(html, techStack);
    const hasContactForm = detectContactForm(html);
    const hasEcommerce = detectEcommerce(html, techStack);
    const { level: automationLevel, signals: automationSignals } = detectAutomationLevel(techStack);
    const mobileFriendly = /<meta[^>]*viewport/i.test(html);
    const detectedPains = detectPains(html, cms, automationLevel);

    const performanceScore = syntheticPerformanceScore(html.length, loadMs);
    const seoScore = syntheticSeoScore(html);
    const siteQualityScore = syntheticQualityScore(html, techStack, hasSSL);

    // Social activity: heuristic based on social links presence
    const hasSocialLinks = /facebook\.com|instagram\.com|twitter\.com|linkedin\.com|tiktok\.com/i.test(html);
    const socialActivity: EnrichmentResult['socialActivity'] = hasSocialLinks ? 'active' : 'unknown';

    logger.debug('Enrichment complete', {
      domain,
      cms,
      automationLevel,
      performanceScore,
      techCount: techStack.length,
      loadMs,
    });

    return {
      techStack,
      cms,
      performanceScore,
      seoScore,
      siteQualityScore,
      mobileFriendly,
      hasSSL,
      hasChatbot,
      hasBookingSystem,
      hasEcommerce,
      hasContactForm,
      automationLevel,
      automationSignals,
      socialActivity,
      detectedPains,
      rawHtmlSnapshot,
      siteStatus: finalStatus,
    };
  } catch (err) {
    logger.error('EnrichmentService.enrichWebsite error', {
      domain,
      error: (err as Error).message,
    });
    return {
      techStack: [],
      cms: 'unknown',
      performanceScore: 0,
      seoScore: 0,
      siteQualityScore: 0,
      mobileFriendly: false,
      hasSSL,
      hasChatbot: false,
      hasBookingSystem: false,
      hasEcommerce: false,
      hasContactForm: false,
      automationLevel: 'none',
      automationSignals: [],
      socialActivity: 'unknown',
      detectedPains: ['Enrichment failed — site could not be analysed'],
      rawHtmlSnapshot: '',
      siteStatus: 'error',
    };
  } finally {
    await context?.close();
  }
}
