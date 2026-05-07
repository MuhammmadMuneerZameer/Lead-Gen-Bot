/**
 * ScraperService — multi-source business scraper (Playwright-based).
 *
 * Sources:
 *  - gmaps       → Google Maps  (primary, richest data)
 *  - yellowpages → YellowPages.com  (phone numbers, US-focused)
 *  - yelp        → Yelp.com  (reviews, local businesses)
 *  - bing        → Bing web search (finds LinkedIn/Facebook pages + general web)
 *
 * Anti-detection: randomised delays, realistic UA, no-sandbox flags.
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext, Page } from 'playwright-core';
import { logger } from '../lib/logger';
import { sanitizeDomain } from '../utils/sanitize';

chromium.use(StealthPlugin());

export interface ScrapedBusiness {
  businessName: string;
  domain: string;
  website?: string;
  phone?: string;
  email?: string;
  industry?: string;
  location?: { city?: string; country?: string };
  sourceId?: string;
}

export type ScrapeSource = 'gmaps' | 'yellowpages' | 'yelp' | 'bing' | 'linkedin' | 'instagram' | 'manual';

// ── Fingerprint rotation pools ───────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1536, height: 864 },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Browser singleton ────────────────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await (chromium as unknown as { launch: (opts: object) => Promise<Browser> }).launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
    ],
  });
  return browser;
}

export async function closeScraper(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min = 800, max = 2000): Promise<void> {
  return sleep(min + Math.random() * (max - min));
}

function extractDomain(url: string): string {
  try {
    return sanitizeDomain(new URL(url).hostname);
  } catch {
    return sanitizeDomain(url);
  }
}

async function newStealthContext(b: Browser): Promise<BrowserContext> {
  const ctx = await b.newContext({
    userAgent: pickRandom(USER_AGENTS),
    viewport: pickRandom(VIEWPORTS),
    locale: 'en-US',
    colorScheme: 'light',
    permissions: [],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return ctx;
}

// ── Selector resilience helper ───────────────────────────────────────────────

async function trySelectors(page: Page, selectors: string[], timeout = 3000): Promise<string> {
  for (const sel of selectors) {
    try {
      const text = await page.locator(sel).first().textContent({ timeout });
      if (text?.trim()) return text.trim();
    } catch { continue; }
  }
  return '';
}

async function trySelectorsAttr(page: Page, selectors: string[], attr: string, timeout = 3000): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const val = await page.locator(sel).first().getAttribute(attr, { timeout });
      if (val?.trim()) return val.trim();
    } catch { continue; }
  }
  return null;
}

// ── Google Maps scraper ──────────────────────────────────────────────────────

export async function scrapeGoogleMaps(
  query: string,
  location = '',
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  const searchTerm = location ? `${query} in ${location}` : query;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
  logger.info('Scraper[gmaps]: starting', { query, location, maxResults });

  let context: BrowserContext | null = null;
  const results: ScrapedBusiness[] = [];

  try {
    const b = await getBrowser();
    context = await newStealthContext(b);
    const page = await context.newPage();

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[role="feed"], [role="main"]', { timeout: 15000 }).catch(() => {});
    await randomDelay();

    const cookieBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click();
      await randomDelay(500, 1000);
    }

    const resultList = page.locator('[role="feed"]');
    let prevCount = 0;
    let scrollAttempts = 0;
    const maxScrolls = Math.ceil(maxResults / 7) + 2;

    while (scrollAttempts < maxScrolls) {
      await resultList.evaluate(el => (el as HTMLElement).scrollBy(0, 600));
      await randomDelay(1000, 2000);
      const cards = await page.locator('a[href*="/maps/place/"]').count();
      if (cards >= maxResults || cards === prevCount) break;
      prevCount = cards;
      scrollAttempts++;
    }

    const placeLinks = await page.locator('a[href*="/maps/place/"]').all();
    const uniqueLinks = ([...new Set(
      await Promise.all(placeLinks.map(l => l.getAttribute('href'))),
    )].filter(Boolean) as string[]).slice(0, maxResults);

    logger.info('Scraper[gmaps]: found place links', { count: uniqueLinks.length });

    for (const link of uniqueLinks) {
      if (results.length >= maxResults) break;
      try {
        const placeUrl = link.startsWith('http') ? link : `https://www.google.com${link}`;
        await page.goto(placeUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomDelay(600, 1200);

        const name = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => '');
        const category = await trySelectors(page, [
          '[jsaction*="category"] span',
          '[data-attrid="kc:/local:place_type"] span',
          'button[jsaction*="category"]',
          '.DkEaL',
        ]);

        const website = await trySelectorsAttr(page, [
          'a[data-item-id="authority"]',
          'a[aria-label*="website" i]',
          'a[href*="http"]:has-text("Website")',
          'a[data-tooltip="Open website"]',
        ], 'href');

        const address = await trySelectors(page, [
          '[data-item-id="address"] .rogA2c',
          '[data-item-id="address"]',
          'button[data-item-id*="address"] .rogA2c',
          '[data-tooltip="Copy address"]',
        ]);
        const cityMatch = (address ?? '').match(/([A-Za-z\s]+),\s*([A-Z]{2})/);
        const city = cityMatch?.[1]?.trim();

        if (!name?.trim()) continue;
        const businessName = name.trim();
        const domain = website
          ? extractDomain(website)
          : sanitizeDomain(businessName.toLowerCase().replace(/\s+/g, '') + '.com');

        results.push({
          businessName,
          domain,
          website: website ?? undefined,
          industry: category?.trim() || undefined,
          location: city ? { city } : undefined,
          sourceId: link.match(/place\/([^/]+)/)?.[1],
        });

        logger.debug('Scraper[gmaps]: extracted', { businessName, domain });
        await randomDelay(400, 800);
      } catch (err) {
        logger.warn('Scraper[gmaps]: place failed', { link, error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scrapeGoogleMaps error', { query, error: (err as Error).message });
  } finally {
    await context?.close();
  }

  logger.info('Scraper[gmaps]: done', { query, found: results.length });
  return results;
}

// ── Yellow Pages scraper ─────────────────────────────────────────────────────

export async function scrapeYellowPages(
  query: string,
  location = 'United States',
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  const searchUrl = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}&geo_location_terms=${encodeURIComponent(location || 'United States')}`;
  logger.info('Scraper[yellowpages]: starting', { query, location, maxResults });

  let context: BrowserContext | null = null;
  const results: ScrapedBusiness[] = [];

  try {
    const b = await getBrowser();
    context = await newStealthContext(b);
    const page = await context.newPage();

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1000, 2000);

    // Wait for results
    await page.waitForSelector('.result, .srp-listing, .organic .info', { timeout: 10000 }).catch(() => {});

    const listings = await page.locator('.result, .srp-listing, .organic .info').all();
    logger.info('Scraper[yellowpages]: found listings', { count: listings.length });

    for (const listing of listings.slice(0, maxResults)) {
      try {
        const name = await listing.locator('.business-name, [itemprop="name"]').first()
          .textContent({ timeout: 3000 }).catch(() => '');
        if (!name?.trim()) continue;

        const phone = await listing.locator('.phones, .phone, [itemprop="telephone"]').first()
          .textContent({ timeout: 3000 }).catch(() => '');

        // Get the detail URL to extract website
        const detailHref = await listing.locator('a.business-name, a[itemprop="url"]').first()
          .getAttribute('href', { timeout: 3000 }).catch(() => null);

        let website: string | undefined;
        let city: string | undefined;
        let category: string | undefined;

        // Try to get category
        category = await listing.locator('.categories a, .category').first()
          .textContent({ timeout: 2000 }).catch(() => undefined) ?? undefined;

        // Get city from address
        const address = await listing.locator('[itemprop="streetAddress"], .adr, .address').first()
          .textContent({ timeout: 2000 }).catch(() => '');
        const cityMatch = (address ?? '').match(/([A-Za-z\s]+),\s*[A-Z]{2}/);
        city = cityMatch?.[1]?.trim();

        // Get website link if shown in listing
        const websiteHref = await listing.locator('a.track-visit-website, a[href*="http"]:has-text("Website")').first()
          .getAttribute('href', { timeout: 2000 }).catch(() => null);
        if (websiteHref && websiteHref.startsWith('http')) {
          website = websiteHref;
        }

        // If no website in listing, try visiting the detail page
        if (!website && detailHref) {
          try {
            const detailUrl = detailHref.startsWith('http')
              ? detailHref
              : `https://www.yellowpages.com${detailHref}`;
            const detailPage = await context!.newPage();
            await detailPage.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
            await randomDelay(500, 1000);
            const siteLink = await detailPage.locator('a.website-link, a.track-visit-website, a[href*="http"]:has-text("website")').first()
              .getAttribute('href', { timeout: 3000 }).catch(() => null);
            if (siteLink && siteLink.startsWith('http') && !siteLink.includes('yellowpages.com')) {
              website = siteLink;
            }
            await detailPage.close();
          } catch {
            // ignore detail page failures
          }
        }

        const businessName = name.trim();
        const domain = website
          ? extractDomain(website)
          : sanitizeDomain(businessName.toLowerCase().replace(/\s+/g, ''));

        if (!domain || domain.length < 3) continue;

        results.push({
          businessName,
          domain,
          website,
          phone: phone?.trim() || undefined,
          industry: category?.trim() || undefined,
          location: city ? { city, country: 'US' } : undefined,
        });

        logger.debug('Scraper[yellowpages]: extracted', { businessName, domain, phone: !!phone });
      } catch (err) {
        logger.warn('Scraper[yellowpages]: listing failed', { error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scrapeYellowPages error', { query, error: (err as Error).message });
  } finally {
    await context?.close();
  }

  logger.info('Scraper[yellowpages]: done', { query, found: results.length });
  return results;
}

// ── Yelp scraper ─────────────────────────────────────────────────────────────

export async function scrapeYelp(
  query: string,
  location = '',
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  const loc = location || 'United States';
  const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(query)}&find_loc=${encodeURIComponent(loc)}`;
  logger.info('Scraper[yelp]: starting', { query, location: loc, maxResults });

  let context: BrowserContext | null = null;
  const results: ScrapedBusiness[] = [];

  try {
    const b = await getBrowser();
    context = await newStealthContext(b);
    const page = await context.newPage();

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1500, 2500);

    // Yelp uses dynamic rendering — wait for result cards
    await page.waitForSelector('[data-testid="serp-ia-card"], .container__09f24__mpR8_, h3 a[href*="/biz/"]', {
      timeout: 12000,
    }).catch(() => {});

    // Extract all business links
    const bizLinks = await page.locator('h3 a[href*="/biz/"], a[href*="/biz/"]:has(h3)').all();
    const uniqueHrefs = [...new Set(
      (await Promise.all(bizLinks.map(l => l.getAttribute('href')))).filter(Boolean) as string[],
    )].slice(0, maxResults);

    logger.info('Scraper[yelp]: found biz links', { count: uniqueHrefs.length });

    for (const href of uniqueHrefs) {
      if (results.length >= maxResults) break;
      try {
        const bizUrl = href.startsWith('http') ? href : `https://www.yelp.com${href.split('?')[0]}`;
        const bizPage = await context.newPage();

        await bizPage.goto(bizUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomDelay(800, 1400);

        const name = await bizPage.locator('h1').first()
          .textContent({ timeout: 5000 }).catch(() => '');
        if (!name?.trim()) { await bizPage.close(); continue; }

        const category = await trySelectors(bizPage, [
          '[data-testid="bizDetailsLocalBizCategory"] a',
          '.arrange-unit a[href*="category"]',
          'span[class*="category"] a',
          'a[href*="/c/"]',
        ]);

        const websiteEl = await trySelectorsAttr(bizPage, [
          'a[href*="biz_redir"]',
          'a[data-testid="bizDetailsWebsite"]',
          'a[href*="redirect_url"]',
          'p a[href*="http"]:not([href*="yelp.com"])',
        ], 'href');

        // Extract actual domain from Yelp redirect URL
        let website: string | undefined;
        if (websiteEl) {
          const urlMatch = websiteEl.match(/url=([^&]+)/);
          if (urlMatch) {
            try { website = decodeURIComponent(urlMatch[1]); } catch { website = websiteEl; }
          } else if (websiteEl.startsWith('http') && !websiteEl.includes('yelp.com')) {
            website = websiteEl;
          }
        }

        // Phone
        const phone = await bizPage.locator('p[data-testid="bizDetailsInfoPhone"], .biz-phone').first()
          .textContent({ timeout: 3000 }).catch(() => undefined);

        // Location
        const cityText = await bizPage.locator('[data-testid="bizDetailsAddress"] p, .map-box-address').first()
          .textContent({ timeout: 3000 }).catch(() => '');
        const cityMatch = (cityText ?? '').match(/([A-Za-z\s]+),\s*[A-Z]{2}/);
        const city = cityMatch?.[1]?.trim();

        await bizPage.close();

        const businessName = name.trim();
        const domain = website
          ? extractDomain(website)
          : sanitizeDomain(businessName.toLowerCase().replace(/\s+/g, ''));

        if (!domain || domain.length < 3) continue;

        results.push({
          businessName,
          domain,
          website,
          phone: phone && phone.replace(/\D+/g, '').length >= 7 ? phone.trim() : undefined,
          industry: category?.trim() || undefined,
          location: city ? { city } : undefined,
          sourceId: href.match(/\/biz\/([^/?]+)/)?.[1],
        });

        logger.debug('Scraper[yelp]: extracted', { businessName, domain });
        await randomDelay(600, 1000);
      } catch (err) {
        logger.warn('Scraper[yelp]: biz page failed', { href, error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scrapeYelp error', { query, error: (err as Error).message });
  } finally {
    await context?.close();
  }

  logger.info('Scraper[yelp]: done', { query, found: results.length });
  return results;
}

// ── Bing web search scraper (finds LinkedIn / Facebook / general biz pages) ──

export async function scrapeBing(
  query: string,
  location = '',
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  const q = location ? `${query} ${location} business` : `${query} business website`;
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=30`;
  logger.info('Scraper[bing]: starting', { query, location, maxResults });

  let context: BrowserContext | null = null;
  const results: ScrapedBusiness[] = [];

  try {
    const b = await getBrowser();
    context = await newStealthContext(b);
    const page = await context.newPage();

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(800, 1500);

    // Extract all organic result cards
    const cards = await page.locator('.b_algo').all();
    logger.info('Scraper[bing]: result cards', { count: cards.length });

    for (const card of cards.slice(0, maxResults + 10)) {
      if (results.length >= maxResults) break;
      try {
        const titleEl = card.locator('h2 a').first();
        const title = await titleEl.textContent({ timeout: 2000 }).catch(() => '');
        const href = await titleEl.getAttribute('href', { timeout: 2000 }).catch(() => null);

        if (!href || !title?.trim()) continue;

        // Skip results from social media aggregators, news sites, etc.
        const skipDomains = ['bing.com', 'microsoft.com', 'wikipedia.org', 'youtube.com',
          'amazon.com', 'google.com', 'tripadvisor.com', 'bbb.org'];
        const hrefDomain = extractDomain(href);
        if (skipDomains.some(d => hrefDomain.includes(d))) continue;

        // Try to get a snippet for industry clues
        const snippet = await card.locator('.b_caption p').first()
          .textContent({ timeout: 2000 }).catch(() => '');

        const businessName = title
          .replace(/\s*[-|]\s*.+$/, '')   // remove "— Site Name" suffixes
          .replace(/\s*(LLC|Inc\.?|Ltd\.?|Corp\.?)$/i, '')
          .trim();

        if (!businessName || businessName.length < 2) continue;
        if (!hrefDomain || hrefDomain.length < 3) continue;

        // Guess industry from snippet
        const industryHint = (snippet ?? '').slice(0, 200);

        results.push({
          businessName,
          domain: hrefDomain,
          website: href,
          industry: industryHint.length > 10 ? undefined : undefined, // enrichment will classify
          location: location ? { city: location } : undefined,
        });
        logger.debug('Scraper[bing]: extracted', { businessName, domain: hrefDomain });
      } catch (err) {
        logger.warn('Scraper[bing]: card failed', { error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scrapeBing error', { query, error: (err as Error).message });
  } finally {
    await context?.close();
  }

  logger.info('Scraper[bing]: done', { query, found: results.length });
  return results;
}

// ── Dispatcher: route to the right scraper by source ────────────────────────

export async function scrapeSource(
  source: ScrapeSource,
  query: string,
  location?: string,
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  switch (source) {
    case 'gmaps':
      return scrapeGoogleMaps(query, location, maxResults);
    case 'yellowpages':
      return scrapeYellowPages(query, location, maxResults);
    case 'yelp':
      return scrapeYelp(query, location, maxResults);
    case 'linkedin':
    case 'bing':
      return scrapeBing(query, location, maxResults);
    case 'instagram':
      logger.warn('Instagram scraper not implemented — skipping');
      return [];
    default:
      logger.warn('Unknown source, skipping', { source });
      return [];
  }
}
