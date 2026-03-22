// app/api/youtube/search/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Store your key in .env.local as YOUTUBE_API_KEY
const YT_KEY = process.env.YOUTUBE_API_KEY ?? '';

export interface YTVideoResult {
  videoId:      string;
  title:        string;
  channelTitle: string;
  thumbnail:    string; // medium res URL
  durationSec:  number; // total seconds (from contentDetails)
}

// ISO 8601 duration → seconds  (e.g. PT3M45S → 225)
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Missing q' }, { status: 400 });
  if (!YT_KEY) return NextResponse.json({ error: 'YouTube API key not configured' }, { status: 500 });

  // 1. Search for videos
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', q);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', '8');
  searchUrl.searchParams.set('videoCategoryId', '10'); // Music category
  searchUrl.searchParams.set('key', YT_KEY);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    const err = await searchRes.json().catch(() => ({}));
    return NextResponse.json({ error: (err as any)?.error?.message ?? 'Search failed' }, { status: 502 });
  }
  const searchData = await searchRes.json();
  const items: any[] = searchData.items ?? [];
  const videoIds = items.map((i: any) => i.id?.videoId).filter(Boolean).join(',');

  if (!videoIds) return NextResponse.json([]);

  // 2. Fetch durations via videos.list (contentDetails)
  const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  detailUrl.searchParams.set('part', 'contentDetails');
  detailUrl.searchParams.set('id', videoIds);
  detailUrl.searchParams.set('key', YT_KEY);

  const detailRes = await fetch(detailUrl.toString());
  const detailData = detailRes.ok ? await detailRes.json() : { items: [] };
  const durationMap: Record<string, number> = {};
  for (const v of (detailData.items ?? [])) {
    durationMap[v.id] = parseDuration(v.contentDetails?.duration ?? '');
  }

  const results: YTVideoResult[] = items
    .filter((i: any) => i.id?.videoId)
    .map((i: any) => ({
      videoId:      i.id.videoId,
      title:        i.snippet.title,
      channelTitle: i.snippet.channelTitle,
      thumbnail:    i.snippet.thumbnails?.medium?.url ?? i.snippet.thumbnails?.default?.url ?? '',
      durationSec:  durationMap[i.id.videoId] ?? 0,
    }));

  return NextResponse.json(results);
}