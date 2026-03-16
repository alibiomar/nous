export interface ParsedYouTubeUrl {
  videoId: string | null;
  playlistId: string | null;
}

const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{6,}$/;
const PLAYLIST_ID_REGEX = /^[A-Za-z0-9_-]{10,}$/;

function normalizeInputUrl(input: string) {
  const value = input.trim();

  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function isYouTubeHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be'
  );
}

function pickValidId(value: string | null, regex: RegExp) {
  if (!value) {
    return null;
  }

  return regex.test(value) ? value : null;
}

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  const normalized = normalizeInputUrl(input);

  if (!normalized) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (!isYouTubeHost(parsed.hostname)) {
    return null;
  }

  let videoId: string | null = null;
  let playlistId: string | null = pickValidId(parsed.searchParams.get('list'), PLAYLIST_ID_REGEX);

  if (parsed.hostname.toLowerCase() === 'youtu.be') {
    videoId = pickValidId(parsed.pathname.replace(/^\//, ''), VIDEO_ID_REGEX);
  } else if (parsed.pathname === '/watch') {
    videoId = pickValidId(parsed.searchParams.get('v'), VIDEO_ID_REGEX);
  } else if (parsed.pathname.startsWith('/shorts/')) {
    videoId = pickValidId(parsed.pathname.split('/')[2] ?? null, VIDEO_ID_REGEX);
  } else if (parsed.pathname.startsWith('/embed/')) {
    videoId = pickValidId(parsed.pathname.split('/')[2] ?? null, VIDEO_ID_REGEX);
  } else if (parsed.pathname === '/playlist') {
    videoId = null;
  }

  if (!videoId && !playlistId) {
    return null;
  }

  return {
    videoId,
    playlistId,
  };
}

export function buildYouTubeEmbedUrl(parsed: ParsedYouTubeUrl) {
  const params = new URLSearchParams();

  if (parsed.playlistId) {
    params.set('list', parsed.playlistId);
  }

  if (parsed.videoId) {
    return `https://www.youtube.com/embed/${parsed.videoId}${params.toString() ? `?${params.toString()}` : ''}`;
  }

  return `https://www.youtube.com/embed/videoseries?${params.toString()}`;
}

export async function fetchYouTubeTitle(url: string): Promise<string> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!response.ok) {
      return 'Unknown Title';
    }
    const data = await response.json();
    return data.title || 'Unknown Title';
  } catch (err) {
    return 'Unknown Title';
  }
}
