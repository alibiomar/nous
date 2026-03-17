import { chromium, Browser, BrowserContext } from 'playwright';
import * as cheerio from 'cheerio';
import * as fsLib from 'fs';
import * as path from 'path';

const BASE_URL = 'https://tuniflix.site';

export interface TuniflixSearchResult {
  title: string;
  slug: string;
  type: 'movie' | 'series';
  image: string | null;
  link: string;
}

export interface TuniflixEpisodeItem {
  title: string;
  slug: string | null;
  link: string | null;
}

export interface TuniflixSeason {
  season: string;
  episodes: TuniflixEpisodeItem[];
}

export interface TuniflixEpisodeSource {
  embed: string | null;
  stream: string | null;
}

export interface TuniflixMovieSource {
  title: string;
  embed: string | null;
  stream: string | null;
}

// ------ CACHING ------
const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, { value: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return cached.value as T;
}

function setCached<T>(key: string, value: T): T {
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return value;
}

// ------ PLAYWRIGHT SINGLETON ------
let browserState: { browser: Browser; context: BrowserContext } | null = null;
const SESSION_FILE = path.join(process.cwd(), 'tuniflix_session.json');

async function getBrowserContext(): Promise<BrowserContext> {
  if (browserState) {
    return browserState.context;
  }

  const browser = await chromium.launch({ headless: true });
  
  const ctxOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  const context = fsLib.existsSync(SESSION_FILE)
    ? await browser.newContext({ ...ctxOptions, storageState: SESSION_FILE })
    : await browser.newContext(ctxOptions);

  browserState = { browser, context };
  return context;
}

async function saveSession() {
  if (browserState) {
    await browserState.context.storageState({ path: SESSION_FILE });
  }
}

async function fetchHtmlWithPlaywright(url: string): Promise<string> {
  const context = await getBrowserContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Cloudflare check
    let title = await page.title();
    if (title.includes('Just a moment') || title.includes('Cloudflare')) {
      // Waiting for challenge to pass
      await page.waitForTimeout(6000);
      await saveSession(); // Save the session once it passes CF
    }

    // Many pages hydrate episode blocks after initial DOM load.
    await page
      .waitForSelector('a[href*="/episode/"], a[href*="/episodio/"], .se-c', {
        timeout: 5000,
      })
      .catch(() => undefined);

    return await page.content();
  } finally {
    await page.close();
  }
}

// Network sniffing to catch the raw m3u8 directly rather than parsing HTML
async function captureM3U8Playwright(embedUrl: string | null): Promise<string | null> {
  if (!embedUrl) return null;

  const context = await getBrowserContext();
  const page = await context.newPage();
  let streamUrl: string | null = null;

  try {
    const streamPromise = new Promise<string | null>((resolve) => {
      page.on('request', (req) => {
        const u = req.url();
        if (u.includes('.m3u8')) {
          resolve(u);
        }
      });
      // Fallback timeout just in case it doesn't load
      setTimeout(() => resolve(null), 12000);
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const captured = await streamPromise;
    if (captured) streamUrl = captured;
  } catch (err) {
    console.error('Playwright M3U8 Capture Error:', err);
  } finally {
    await page.close();
  }

  return streamUrl;
}

// ------ UTILS ------
function normalizeToAbsoluteUrl(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url, BASE_URL).toString(); } catch { return null; }
}

function extractSlugFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch { return null; }
}

function extractSeasonNumberFromSlug(slug: string | null): number | null {
  if (!slug) {
    return null;
  }

  const match = slug.match(/-(\d+)$/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

// ------ API METHODS ------
export async function searchTuniflix(query: string): Promise<TuniflixSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `search:${trimmed.toLowerCase()}`;
  const cached = getCached<TuniflixSearchResult[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/?s=${encodeURIComponent(trimmed)}`;
  const html = await fetchHtmlWithPlaywright(url);
  const $ = cheerio.load(html);
  const results: TuniflixSearchResult[] = [];

  $('article').each((_, element) => {
    const title = $(element).find('h2').first().text().trim();
    const rawLink = $(element).find('a').first().attr('href');
    const rawImage = $(element).find('img').first().attr('src') ?? $(element).find('img').first().attr('data-src');

    const link = normalizeToAbsoluteUrl(rawLink);
    const slug = extractSlugFromUrl(link);

    if (!title || !link || !slug) return;

    const type: 'movie' | 'series' = link.includes('/serie/') ? 'series' : 'movie';
    results.push({ title, slug, type, image: normalizeToAbsoluteUrl(rawImage), link });
  });

  return setCached(cacheKey, results);
}

export async function getSeries(slug: string): Promise<TuniflixSeason[]> {
  const safeSlug = slug.trim();
  const cacheKey = `series:${safeSlug.toLowerCase()}`;
  const cached = getCached<TuniflixSeason[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/serie/${encodeURIComponent(safeSlug)}`;
  const html = await fetchHtmlWithPlaywright(url);
  const $ = cheerio.load(html);
  const seasons: TuniflixSeason[] = [];

  const seasonCandidates: Array<{ name: string; link: string; number: number | null }> = [];
  const seenSeasons = new Set<string>();

  $('a[href*="/season/"]').each((_, anchor) => {
    const rawLink = $(anchor).attr('href');
    const link = normalizeToAbsoluteUrl(rawLink);
    const seasonSlug = extractSlugFromUrl(link);

    if (!link || !seasonSlug || seenSeasons.has(seasonSlug)) {
      return;
    }

    seenSeasons.add(seasonSlug);

    const seasonNumber = extractSeasonNumberFromSlug(seasonSlug);
    const seasonName =
      $(anchor).text().trim() ||
      (seasonNumber ? `Season ${seasonNumber}` : 'Season');

    seasonCandidates.push({
      name: seasonName,
      link,
      number: seasonNumber,
    });
  });

  seasonCandidates.sort((a, b) => {
    if (a.number === null && b.number === null) return 0;
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  });

  for (const season of seasonCandidates) {
    const seasonHtml = await fetchHtmlWithPlaywright(season.link);
    const $$ = cheerio.load(seasonHtml);
    const episodes: TuniflixEpisodeItem[] = [];
    const seenEpisodes = new Set<string>();

    $$('a[href*="/episode/"], a[href*="/episodio/"], a[href*="/episodes/"]').each(
      (_, anchor) => {
        const rawLink = $$(anchor).attr('href');
        const link = normalizeToAbsoluteUrl(rawLink);
        const episodeSlug = extractSlugFromUrl(link);

        if (!link || !episodeSlug || seenEpisodes.has(episodeSlug)) {
          return;
        }

        seenEpisodes.add(episodeSlug);

        const fallbackEpisodeNumber = episodes.length + 1;
        const title =
          $$(anchor).text().trim() ||
          (season.number
            ? `Episode ${season.number}x${fallbackEpisodeNumber}`
            : `Episode ${fallbackEpisodeNumber}`);

        episodes.push({
          title,
          slug: episodeSlug,
          link,
        });
      }
    );

    if (episodes.length > 0) {
      seasons.push({
        season: season.name,
        episodes,
      });
    }
  }

  // Fallback for layouts that directly expose episode links on /serie page.
  if (seasons.length === 0) {
    const fallbackEpisodes: TuniflixEpisodeItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/episode/"], a[href*="/episodio/"], a[href*="/episodes/"]').each(
      (_, anchor) => {
        const rawLink = $(anchor).attr('href');
        const link = normalizeToAbsoluteUrl(rawLink);
        const episodeSlug = extractSlugFromUrl(link);

        if (!link || !episodeSlug || seen.has(episodeSlug)) {
          return;
        }

        seen.add(episodeSlug);
        const title = $(anchor).text().trim() || `Episode ${fallbackEpisodes.length + 1}`;

        fallbackEpisodes.push({
          title,
          slug: episodeSlug,
          link,
        });
      }
    );

    if (fallbackEpisodes.length > 0) {
      seasons.push({
        season: 'Season 1',
        episodes: fallbackEpisodes,
      });
    }
  }

  if (seasons.length === 0) {
    return seasons;
  }

  return setCached(cacheKey, seasons);
}

export async function getEpisode(slug: string): Promise<TuniflixEpisodeSource> {
  const safeSlug = slug.trim();
  const cacheKey = `episode:${safeSlug.toLowerCase()}`;
  const cached = getCached<TuniflixEpisodeSource>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/episode/${encodeURIComponent(safeSlug)}`;
  const html = await fetchHtmlWithPlaywright(url);
  const $ = cheerio.load(html);

  const iframeSrc = $('iframe').first().attr('src');
  const embed = normalizeToAbsoluteUrl(iframeSrc);
  const stream = await captureM3U8Playwright(embed);

  return setCached(cacheKey, { embed, stream });
}

export async function getMovie(slug: string): Promise<TuniflixMovieSource> {
  const safeSlug = slug.trim();
  const cacheKey = `movie:${safeSlug.toLowerCase()}`;
  const cached = getCached<TuniflixMovieSource>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/movie/${encodeURIComponent(safeSlug)}`;
  const html = await fetchHtmlWithPlaywright(url);
  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim();
  const iframeSrc = $('iframe').first().attr('src');
  const embed = normalizeToAbsoluteUrl(iframeSrc);
  const stream = await captureM3U8Playwright(embed);

  return setCached(cacheKey, { title, embed, stream });
}
