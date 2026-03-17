import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium, Browser } from 'playwright-core';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://tuniflix.site';

// --- Types ---
export interface TuniflixSearchResult {
  title: string; slug: string; type: 'movie' | 'series';
  image: string | null; link: string;
}
export interface TuniflixEpisodeItem { title: string; slug: string | null; link: string | null; }
export interface TuniflixSeason { season: string; episodes: TuniflixEpisodeItem[]; }
export interface TuniflixEpisodeSource { embed: string | null; stream: string | null; }
export interface TuniflixMovieSource { title: string; embed: string | null; stream: string | null; }

// --- Cache ---
type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.value as T;
}
function setCached<T>(key: string, value: T, ttlMs: number): T {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

const TTL = {
  search: 5 * 60 * 1000,
  series: 30 * 60 * 1000,
  episode: 30 * 60 * 1000,
  movie: 30 * 60 * 1000,
};

// --- Lightweight fetch (no browser) ---
async function fetchHtmlLightweight(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const text = await res.text();

    if (
      text.includes('Just a moment') ||
      text.includes('cf-browser-verification') ||
      text.includes('_cf_chl_opt')
    ) {
      return null;
    }

    return text;
  } catch {
    return null;
  }
}

// --- Browser launch (updated) ---
async function launchBrowser(): Promise<Browser> {
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchBrowser();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function fetchHtmlWithBrowser(browser: Browser, url: string): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    const title = await page.title();
    if (title.includes('Just a moment') || title.includes('Cloudflare')) {
      await page.waitForTimeout(7000);
    }

    await page
      .waitForSelector('a[href*="/episode/"], a[href*="/episodio/"], article, .se-c', { timeout: 5000 })
      .catch(() => undefined);

    return await page.content();
  } finally {
    await page.close();
  }
}

// --- Smart fetch: lightweight first, browser fallback ---
async function fetchHtml(url: string, browserInstance: Browser | null = null): Promise<string> {
  const lightweight = await fetchHtmlLightweight(url);
  if (lightweight) return lightweight;

  if (browserInstance) {
    return fetchHtmlWithBrowser(browserInstance, url);
  }

  return withBrowser((browser) => fetchHtmlWithBrowser(browser, url));
}

// --- M3U8 capture ---
async function captureM3U8(browser: Browser, embedUrl: string): Promise<string | null> {
  const page = await browser.newPage();
  let streamUrl: string | null = null;

  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font'].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const streamPromise = new Promise<string | null>((resolve) => {
      page.on('request', (req) => {
        if (req.url().includes('.m3u8')) resolve(req.url());
      });
      setTimeout(() => resolve(null), 10000);
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
    streamUrl = await streamPromise;
  } catch (err) {
    console.error('M3U8 capture error:', err);
  } finally {
    await page.close();
  }

  return streamUrl;
}

// --- Utils ---
function normalizeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url, BASE_URL).toString(); } catch { return null; }
}

function extractSlug(url: string | null): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch { return null; }
}

function extractSeasonNumber(slug: string | null): number | null {
  if (!slug) return null;
  const match = slug.match(/-(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

// --- Public API ---

export async function searchTuniflix(query: string): Promise<TuniflixSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `search:${trimmed.toLowerCase()}`;
  const cached = getCached<TuniflixSearchResult[]>(cacheKey);
  if (cached) return cached;

  return withBrowser(async (browser) => {
    const html = await fetchHtmlWithBrowser(browser, `${BASE_URL}/?s=${encodeURIComponent(trimmed)}`);
    const $ = cheerio.load(html);
    const results: TuniflixSearchResult[] = [];

    $('article').each((_, el) => {
      const title = $(el).find('h2').first().text().trim();
      const link = normalizeUrl($(el).find('a').first().attr('href'));
      const slug = extractSlug(link);
      if (!title || !link || !slug) return;

      const img = $(el).find('img').first();
      const rawImage = img.attr('src') ?? img.attr('data-src');

      results.push({
        title, slug,
        type: link.includes('/serie/') ? 'series' : 'movie',
        image: normalizeUrl(rawImage),
        link,
      });
    });

    return setCached(cacheKey, results, TTL.search);
  });
}

export async function getSeries(slug: string): Promise<TuniflixSeason[]> {
  const cacheKey = `series:${slug.toLowerCase()}`;
  const cached = getCached<TuniflixSeason[]>(cacheKey);
  if (cached) return cached;

  return withBrowser(async (browser) => {
    const html = await fetchHtml(`${BASE_URL}/serie/${encodeURIComponent(slug)}`, browser);
    const $ = cheerio.load(html);

    const seenSeasons = new Set<string>();
    const seasonCandidates: Array<{ name: string; link: string; number: number | null }> = [];

    $('a[href*="/season/"]').each((_, anchor) => {
      const link = normalizeUrl($(anchor).attr('href'));
      const seasonSlug = extractSlug(link);
      if (!link || !seasonSlug || seenSeasons.has(seasonSlug)) return;
      seenSeasons.add(seasonSlug);

      const number = extractSeasonNumber(seasonSlug);
      seasonCandidates.push({
        name: $(anchor).text().trim() || (number ? `Season ${number}` : 'Season'),
        link,
        number,
      });
    });

    seasonCandidates.sort((a, b) => {
      if (a.number === null) return 1;
      if (b.number === null) return -1;
      return a.number - b.number;
    });

    const seasonResults = await Promise.all(
      seasonCandidates.map(async (season) => {
        const seasonHtml = await fetchHtml(season.link, browser);
        const $$ = cheerio.load(seasonHtml);
        const episodes: TuniflixEpisodeItem[] = [];
        const seenEpisodes = new Set<string>();

        $$('a[href*="/episode/"], a[href*="/episodio/"], a[href*="/episodes/"]').each((_, anchor) => {
          const link = normalizeUrl($$(anchor).attr('href'));
          const episodeSlug = extractSlug(link);
          if (!link || !episodeSlug || seenEpisodes.has(episodeSlug)) return;
          seenEpisodes.add(episodeSlug);

          const n = episodes.length + 1;
          episodes.push({
            title: $$(anchor).text().trim() || (season.number ? `Episode ${season.number}x${n}` : `Episode ${n}`),
            slug: episodeSlug,
            link,
          });
        });

        return episodes.length > 0 ? { season: season.name, episodes } : null;
      })
    );

    let seasons: TuniflixSeason[] = seasonResults.filter(Boolean) as TuniflixSeason[];

    if (seasons.length === 0) {
      const fallback: TuniflixEpisodeItem[] = [];
      const seen = new Set<string>();
      $('a[href*="/episode/"], a[href*="/episodio/"], a[href*="/episodes/"]').each((_, anchor) => {
        const link = normalizeUrl($(anchor).attr('href'));
        const episodeSlug = extractSlug(link);
        if (!link || !episodeSlug || seen.has(episodeSlug)) return;
        seen.add(episodeSlug);
        fallback.push({
          title: $(anchor).text().trim() || `Episode ${fallback.length + 1}`,
          slug: episodeSlug,
          link,
        });
      });
      if (fallback.length > 0) seasons = [{ season: 'Season 1', episodes: fallback }];
    }

    return setCached(cacheKey, seasons, TTL.series);
  });
}

export async function getEpisode(slug: string): Promise<TuniflixEpisodeSource> {
  const cacheKey = `episode:${slug.toLowerCase()}`;
  const cached = getCached<TuniflixEpisodeSource>(cacheKey);
  if (cached) return cached;

  return withBrowser(async (browser) => {
    const html = await fetchHtml(`${BASE_URL}/episode/${encodeURIComponent(slug)}`, browser);
    const embed = normalizeUrl(cheerio.load(html)('iframe').first().attr('src'));
    const stream = embed ? await captureM3U8(browser, embed) : null;
    return setCached(cacheKey, { embed, stream }, TTL.episode);
  });
}

export async function getMovie(slug: string): Promise<TuniflixMovieSource> {
  const cacheKey = `movie:${slug.toLowerCase()}`;
  const cached = getCached<TuniflixMovieSource>(cacheKey);
  if (cached) return cached;

  return withBrowser(async (browser) => {
    const html = await fetchHtml(`${BASE_URL}/movie/${encodeURIComponent(slug)}`, browser);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim();
    const embed = normalizeUrl($('iframe').first().attr('src'));
    const stream = embed ? await captureM3U8(browser, embed) : null;
    return setCached(cacheKey, { title, embed, stream }, TTL.movie);
  });
}