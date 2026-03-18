'use client';

import { useEffect, useRef, useState } from 'react';

const SEEK_THRESHOLD = 2;
const SUPPRESS_MS = 300;

type PlaybackAction = 'play' | 'pause' | 'seek';

export interface HlsPlaybackPayload {
  syncId: string;
  senderId: string;
  action: PlaybackAction;
  currentTime: number;
  happenedAt: number;
}

// ─── YouTube helpers ──────────────────────────────────────────────────────────

function isYouTubeSrc(src: string): boolean {
  try {
    const host = new URL(src).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com';
  } catch {
    return false;
  }
}

function ensureYouTubeApiEnabled(src: string): string {
  try {
    const url = new URL(src);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', window.location.origin);
    return url.toString();
  } catch {
    return src;
  }
}

// Module-level singleton — load the YT script once
let youtubeApiPromise: Promise<YoutubeNS> | null = null;

interface YoutubeNS {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number };
}
interface YTPlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (t: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  unMute: () => void;
}
interface YTPlayerOptions {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (e: { data: number }) => void;
  };
}

declare global {
  interface Window {
    YT?: YoutubeNS;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<YoutubeNS> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YoutubeNS>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else { youtubeApiPromise = null; reject(new Error('YT API loaded without Player')); }
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { youtubeApiPromise = null; reject(new Error('Failed to load YT API')); };
      document.body.appendChild(s);
    }
  });

  return youtubeApiPromise;
}

function safeDestroyYT(player: YTPlayer | null) {
  if (!player) return;
  try { player.destroy(); } catch (e) {
    if (!(e instanceof DOMException) || e.name !== 'NotFoundError') throw e;
  }
}

function extractYouTubeVideoId(src: string): string | null {
  try {
    const url = new URL(src);
    // /embed/VIDEO_ID
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed' && parts[1]) return parts[1];
    // ?v=VIDEO_ID
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

// ─── YouTube sub-player ───────────────────────────────────────────────────────

function YouTubeEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
  senderIdRef,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
  senderIdRef: React.MutableRefObject<string>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const ytRef = useRef<YoutubeNS | null>(null);
  const applyingRemoteRef = useRef(false);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(true);

  const videoId = extractYouTubeVideoId(src);

  // ── Init YT player ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setPlayerError(null);
    setBuffering(true);
    isPlayingRef.current = false;

    loadYouTubeApi()
      .then((yt) => {
        if (cancelled || !containerRef.current) return;
        ytRef.current = yt;
        safeDestroyYT(playerRef.current);
        playerRef.current = null;

        playerRef.current = new yt.Player(containerRef.current, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => setBuffering(false),
            onStateChange: async (event) => {
              if (applyingRemoteRef.current || !playerRef.current || !ytRef.current) return;
              const currentTime = playerRef.current.getCurrentTime();
              currentTimeRef.current = currentTime;

              if (event.data === ytRef.current.PlayerState.PLAYING) {
                isPlayingRef.current = true;
                onPlaybackChange?.('play', currentTime);
              } else if (event.data === ytRef.current.PlayerState.PAUSED) {
                isPlayingRef.current = false;
                onPlaybackChange?.('pause', currentTime);
              }
            },
          },
        });
      })
      .catch((err) => {
        if (!cancelled) setPlayerError(err instanceof Error ? err.message : 'Failed to load YouTube player');
      });

    return () => {
      cancelled = true;
      isPlayingRef.current = false;
      safeDestroyYT(playerRef.current);
      playerRef.current = null;
    };
  }, [videoId, onPlaybackChange]);

  // ── Apply external sync ───────────────────────────────────────────────────
  useEffect(() => {
    if (!externalSyncEvent || !playerRef.current) return;
    if (externalSyncEvent.senderId === senderIdRef.current) return;
    if (typeof playerRef.current.seekTo !== 'function') return;

    const safeTime = Number.isFinite(externalSyncEvent.currentTime)
      ? Math.max(externalSyncEvent.currentTime, 0) : 0;

    applyingRemoteRef.current = true;

    const delta = Math.abs((playerRef.current.getCurrentTime?.() ?? 0) - safeTime);
    if (delta > SEEK_THRESHOLD) {
      const latency = externalSyncEvent.happenedAt
        ? (Date.now() - externalSyncEvent.happenedAt) / 1000 : 0;
      playerRef.current.seekTo(safeTime + (externalSyncEvent.action === 'play' ? latency : 0), true);
    }

    if (externalSyncEvent.action === 'play') {
      isPlayingRef.current = true;
      playerRef.current.unMute?.();
      playerRef.current.playVideo();
    } else if (externalSyncEvent.action === 'pause') {
      isPlayingRef.current = false;
      playerRef.current.pauseVideo();
    }

    const t = setTimeout(() => { applyingRemoteRef.current = false; }, 250);
    return () => clearTimeout(t);
  }, [externalSyncEvent, senderIdRef]);

  if (playerError) {
    return (
      <div className={`flex items-center justify-center bg-black/40 rounded-xl ${className ?? ''}`}>
        <p className="text-sm text-white/60">{playerError}</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 pointer-events-none">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
    </div>
  );
}

// ─── JWPlayer sub-player ──────────────────────────────────────────────────────

function JWEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
  senderIdRef,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
  senderIdRef: React.MutableRefObject<string>;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentTimeRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Start false — JWPlayer 8 doesn't reliably send ready via postMessage
  const [buffering, setBuffering] = useState(false);

  const suppress = () => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressRef.current = true;
    suppressTimerRef.current = setTimeout(() => { suppressRef.current = false; }, SUPPRESS_MS);
  };

  // JWPlayer 8 accepts both plain objects and JSON strings — send both formats
  const postToPlayer = (method: string, value?: number) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const msg: Record<string, unknown> = { method };
    if (value !== undefined) msg.value = value;
    // JWPlayer 7 expects JSON string, JWPlayer 8 expects plain object
    // Send both to cover all versions
    try { win.postMessage(msg, '*'); } catch { /* ignore */ }
    try { win.postMessage(JSON.stringify(msg), '*'); } catch { /* ignore */ }
  };

  // ── Listen for JWPlayer events ────────────────────────────────────────────
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        // JWPlayer 8 sends plain objects; JWPlayer 7 sends JSON strings
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;

        // JWPlayer 8 wraps events in { id, type, data } — unwrap if needed
        const payload = data.type && data.data ? data.data : data;
        const eventName: string = data.type ?? payload.event ?? '';
        const position: number | undefined =
          typeof payload.position === 'number' ? payload.position :
          typeof data.currentTime === 'number' ? data.currentTime : undefined;

        if (position !== undefined) currentTimeRef.current = position;

        // JWPlayer 8.36 event names
        const isReady = eventName === 'ready' || eventName === 'playerReady' || eventName === 'jwReady';
        const isBuffer = eventName === 'buffer' || eventName === 'bufferChange' || eventName === 'jwBuffer';
        const isBufferFull = eventName === 'bufferFull' || eventName === 'firstFrame' || eventName === 'jwBufferFull';
        const isPlay = eventName === 'play' || eventName === 'jwPlay';
        const isPause = eventName === 'pause' || eventName === 'jwPause';
        const isSeek = eventName === 'seek' || eventName === 'jwSeek';
        const isTime = eventName === 'time' || eventName === 'jwTime';

        if (isReady || isBufferFull) { setBuffering(false); }
        if (isBuffer) { setBuffering(true); }

        if (applyingRemoteRef.current || suppressRef.current) return;

        if (isPlay) onPlaybackChange?.('play', currentTimeRef.current);
        else if (isPause) onPlaybackChange?.('pause', currentTimeRef.current);
        else if (isSeek) onPlaybackChange?.('seek', position ?? currentTimeRef.current);
        else if (isTime && position !== undefined) {
          currentTimeRef.current = position;
        }
      } catch { /* ignore */ }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPlaybackChange]);

  // ── Poll position (fallback for players that don't push time events) ──────
  useEffect(() => {
    const interval = setInterval(() => {
      postToPlayer('getPosition');      // JWPlayer 7
      postToPlayer('getCurrentTime');  // JWPlayer 8 generic
      postToPlayer('jwGetPosition');   // JWPlayer 8.36
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Apply external sync ───────────────────────────────────────────────────
  useEffect(() => {
    if (!externalSyncEvent || !iframeRef.current?.contentWindow) return;
    if (externalSyncEvent.senderId === senderIdRef.current) return;

    suppress();
    applyingRemoteRef.current = true;

    const remoteTime = Number.isFinite(externalSyncEvent.currentTime)
      ? Math.max(externalSyncEvent.currentTime, 0) : null;
    const latency = externalSyncEvent.happenedAt
      ? (Date.now() - externalSyncEvent.happenedAt) / 1000 : 0;

    if (remoteTime !== null && Math.abs(currentTimeRef.current - remoteTime) > SEEK_THRESHOLD) {
      postToPlayer('seek', remoteTime + (externalSyncEvent.action === 'play' ? latency : 0));
    }

    if (externalSyncEvent.action === 'play') postToPlayer('play');
    else if (externalSyncEvent.action === 'pause') postToPlayer('pause');

    const t = setTimeout(() => { applyingRemoteRef.current = false; }, 300);
    return () => clearTimeout(t);
  }, [externalSyncEvent, senderIdRef]);

  useEffect(() => {
    return () => { if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current); };
  }, []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <iframe
        ref={iframeRef}
        src={src}
        className="h-full w-full rounded-xl"
        allowFullScreen
        title={title || 'Video player'}
        allow="autoplay; fullscreen"
      />
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 pointer-events-none">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
    </div>
  );
}

// ─── TuniflixEmbedPlayer — public API ────────────────────────────────────────
// Detects YouTube vs JWPlayer and delegates to the right sub-player.
// Drop-in replacement for a bare <iframe> — accepts the same sync props
// as TuniflixHlsPlayer.

export function TuniflixEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
}) {
  // Stable sender ID shared by both sub-players
  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `embed-${Math.random().toString(36).slice(2)}`
  );

  if (isYouTubeSrc(src)) {
    return (
      <YouTubeEmbedPlayer
        src={src}
        title={title}
        className={className}
        externalSyncEvent={externalSyncEvent}
        onPlaybackChange={onPlaybackChange}
        senderIdRef={senderIdRef}
      />
    );
  }

  return (
    <JWEmbedPlayer
      src={src}
      title={title}
      className={className}
      externalSyncEvent={externalSyncEvent}
      onPlaybackChange={onPlaybackChange}
      senderIdRef={senderIdRef}
    />
  );
}