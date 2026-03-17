import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_EXTENSIONS = ['.m3u8', '.ts', '.aac', '.vtt'];
const MAX_SEGMENT_SIZE = 10 * 1024 * 1024; // 10MB hard limit per segment

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url param', { status: 400 });
  }

  // Only allow proxying known stream-related extensions
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  const ext = parsed.pathname.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.some((e) => parsed.pathname.endsWith(e))) {
    return new NextResponse('Forbidden file type', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        // Forward a realistic browser UA so the origin doesn't block us
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': `${parsed.protocol}//${parsed.host}/`,
        'Origin': `${parsed.protocol}//${parsed.host}`,
      },
      // Don't follow redirects blindly — let us inspect them
      redirect: 'follow',
    });
  } catch {
    return new NextResponse('Failed to fetch upstream', { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(`Upstream error: ${upstream.status}`, { status: upstream.status });
  }

  const contentLength = upstream.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_SEGMENT_SIZE) {
    return new NextResponse('Segment too large', { status: 413 });
  }

  const contentType = upstream.headers.get('content-type') ?? inferContentType(parsed.pathname);

  // For .m3u8 playlists: rewrite all URLs inside to go through this proxy too
  if (parsed.pathname.endsWith('.m3u8')) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, url);

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // For .ts segments and other binary: stream directly
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Rewrite every URL in the m3u8 manifest to go through /api/tuniflix/proxy
function rewriteM3U8(content: string, baseUrl: string): string {
  const base = new URL(baseUrl);

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) return line;

      try {
        // Resolve relative URLs against the base m3u8 URL
        const absolute = new URL(trimmed, base).toString();
        return `/api/tuniflix/proxy?url=${encodeURIComponent(absolute)}`;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function inferContentType(pathname: string): string {
  if (pathname.endsWith('.ts'))  return 'video/mp2t';
  if (pathname.endsWith('.aac')) return 'audio/aac';
  if (pathname.endsWith('.vtt')) return 'text/vtt';
  return 'application/octet-stream';
}