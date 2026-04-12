/**
 * ScraperService — Playwright-based Google Maps business scraper.
 *
 * Targets Google Maps search results for a given query + location.
 * Extracts: business name, website URL, domain, category.
 *
 * Anti-detection measures:
 *  - Randomised delays between actions
 *  - Realistic viewport + user agent
 *  - Proxy rotation via ProxyManager (Phase 2 — passthrough for now)
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { logger } from '../lib/logger';
import { sanitizeDomain } from '../utils/sanitize';

export interface ScrapedBusiness {
  businessName: string;
  domain: string;
  website?: string;
  industry?: string;
  location?: { city?: string; country?: string };
  sourceId?: string;
}

// ── Browser singleton ────────────────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
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

// ── Google Maps scraper ──────────────────────────────────────────────────────

export async function scrapeGoogleMaps(
  query: string,
  location: string = '',
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  const searchTerm = location ? `${query} in ${location}` : query;
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;

  logger.info('Scraper: starting Google Maps search', { query, location, maxResults });

  let context: BrowserContext | null = null;
  const results: ScrapedBusiness[] = [];

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      geolocation: undefined,
      permissions: [],
    });

    const page = await context.newPage();

    // Remove webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay();

    // Accept cookies if prompted
    const cookieBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
    if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieBtn.click();
      await randomDelay(500, 1000);
    }

    // Scroll to load more results
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

    // Get all place links
    const placeLinks = await page.locator('a[href*="/maps/place/"]').all();
    const uniqueLinks = ([...new Set(
      await Promise.all(placeLinks.map(l => l.getAttribute('href'))),
    )].filter(Boolean) as string[]).slice(0, maxResults);

    logger.info('Scraper: found place links', { count: uniqueLinks.length });

    // Visit each place to extract website
    for (const link of uniqueLinks) {
      if (results.length >= maxResults) break;

      try {
        await page.goto(`https://www.google.com${link}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomDelay(600, 1200);

        const name = await page.locator('h1').first().textContent({ timeout: 5000 }).catch(() => '');
        const category = await page.locator('[jsaction*="category"] span, [data-attrid="kc:/local:place_type"] span')
          .first().textContent({ timeout: 3000 }).catch(() => '');

        // Website link
        const websiteEl = page.locator('a[data-item-id="authority"], a[href*="http"]:has-text("Website")').first();
        const website = await websiteEl.getAttribute('href', { timeout: 3000 }).catch(() => null);

        // Address for city extraction
        const address = await page.locator('[data-item-id="address"] .rogA2c').first()
          .textContent({ timeout: 3000 }).catch(() => '');

        const cityMatch = (address ?? '').match(/([A-Za-z\s]+),\s*([A-Z]{2})/);
        const city = cityMatch?.[1]?.trim();

        if (!name?.trim()) continue;

        const businessName = name.trim();
        const domain = website ? extractDomain(website) : sanitizeDomain(businessName.toLowerCase().replace(/\s+/g, '') + '.com');

        const sourceId = link.match(/place\/([^/]+)/)?.[1];

        results.push({
          businessName,
          domain,
          website: website ?? undefined,
          industry: category?.trim() || undefined,
          location: city ? { city } : undefined,
          sourceId,
        });

        logger.debug('Scraper: extracted business', { businessName, domain, website });
        await randomDelay(400, 800);
      } catch (err) {
        logger.warn('Scraper: failed to extract place', { link, error: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error('scrapeGoogleMaps error', { query, error: (err as Error).message });
  } finally {
    await context?.close();
  }

  logger.info('Scraper: Google Maps search complete', { query, found: results.length });
  return results;
}

// ── Dispatcher: route to the right scraper by source ────────────────────────

export async function scrapeSource(
  source: 'gmaps' | 'linkedin' | 'instagram' | 'manual',
  query: string,
  location?: string,
  maxResults = 20,
): Promise<ScrapedBusiness[]> {
  switch (source) {
    case 'gmaps':
      return scrapeGoogleMaps(query, location, maxResults);
    case 'linkedin':
      logger.warn('LinkedIn scraper not yet implemented — returning empty');
      return [];
    case 'instagram':
      logger.warn('Instagram scraper not yet implemented — returning empty');
      return [];
    default:
      return [];
  }
}
