import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_EXTENSIONS = ['.m3u8', '.ts', '.aac', '.vtt'];
const MAX_SEGMENT_SIZE = 10 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  // The embed page URL that originally loaded this stream
  const referer = req.nextUrl.searchParams.get('referer');

  if (!url) {
    return new NextResponse('Missing url param', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  if (!ALLOWED_EXTENSIONS.some((e) => parsed.pathname.endsWith(e))) {
    return new NextResponse('Forbidden file type', { status: 403 });
  }

  // Use provided referer, or fall back to the CDN's own origin
  const effectiveReferer = referer ?? `${parsed.protocol}//${parsed.host}/`;
  const effectiveOrigin = new URL(effectiveReferer).origin;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': effectiveReferer,
        'Origin': effectiveOrigin,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
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

  if (parsed.pathname.endsWith('.m3u8')) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, url, referer);

    return new NextResponse(rewritten, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Pass referer through so segment requests also use the correct referer
function rewriteM3U8(content: string, baseUrl: string, referer: string | null): string {
  const base = new URL(baseUrl);

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      try {
        const absolute = new URL(trimmed, base).toString();
        const proxied = `/api/tuniflix/proxy?url=${encodeURIComponent(absolute)}`;
        // Carry the referer forward into every segment URL
        return referer ? `${proxied}&referer=${encodeURIComponent(referer)}` : proxied;
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