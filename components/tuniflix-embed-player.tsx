'use client';

import { useEffect, useRef, useState } from 'react';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { Play, Pause } from 'lucide-react';
import { Button } from './ui/button';

type PlaybackAction = 'play' | 'pause' | 'seek';

export interface HlsPlaybackPayload {
  syncId: string;
  senderId: string;
  action: PlaybackAction;
  currentTime: number;
  happenedAt: number;
  /** Stamped by useCinemaSync on receipt — guarantees a new object reference
   *  for every incoming event so React always re-renders consumers. */
  receivedAt?: number;
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

function extractYouTubeVideoId(src: string): string | null {
  try {
    const url = new URL(src);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed' && parts[1]) return parts[1];
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

// ─── YouTube API types & loader ───────────────────────────────────────────────

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

let youtubeApiPromise: Promise<YoutubeNS> | null = null;

function loadYouTubeApi(): Promise<YoutubeNS> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YoutubeNS>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else { youtubeApiPromise = null; reject(new Error('YT API failed')); }
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

const SEEK_THRESHOLD = 2;

// ─── YouTube sub-player (full programmatic sync) ──────────────────────────────

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

  const onPlaybackChangeRef = useRef(onPlaybackChange);
  useEffect(() => { onPlaybackChangeRef.current = onPlaybackChange; }, [onPlaybackChange]);

  const videoId = extractYouTubeVideoId(src);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    isPlayingRef.current = false;

    loadYouTubeApi()
      .then((yt) => {
        if (cancelled || !containerRef.current) return;
        ytRef.current = yt;
        safeDestroyYT(playerRef.current);
        playerRef.current = null;

        playerRef.current = new yt.Player(containerRef.current, {
          videoId,
          playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1, enablejsapi: 1, origin: window.location.origin },
          events: {
            onStateChange: (event) => {
              if (applyingRemoteRef.current || !playerRef.current || !ytRef.current) return;
              const currentTime = playerRef.current.getCurrentTime();
              if (event.data === ytRef.current.PlayerState.PLAYING) {
                isPlayingRef.current = true;
                onPlaybackChangeRef.current?.('play', currentTime);
              } else if (event.data === ytRef.current.PlayerState.PAUSED) {
                isPlayingRef.current = false;
                onPlaybackChangeRef.current?.('pause', currentTime);
              }
            },
          },
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      safeDestroyYT(playerRef.current);
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    if (!externalSyncEvent || !playerRef.current) return;
    if (externalSyncEvent.senderId === senderIdRef.current) return;
    if (typeof playerRef.current.seekTo !== 'function') return;

    const safeTime = Number.isFinite(externalSyncEvent.currentTime) ? Math.max(externalSyncEvent.currentTime, 0) : 0;
    applyingRemoteRef.current = true;

    const delta = Math.abs((playerRef.current.getCurrentTime?.() ?? 0) - safeTime);
    if (delta > SEEK_THRESHOLD) {
      const latency = externalSyncEvent.happenedAt ? (Date.now() - externalSyncEvent.happenedAt) / 1000 : 0;
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

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// ─── Generic embed player (JWPlayer, etc.) with visual sync nudge ─────────────

function GenericEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
  currentUserId,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
  currentUserId?: string;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sendPushNotification } = usePushNotifications();

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ✅ Stable ref so the notify closure inside useEffect never goes stale.
  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; });

  const notify = (msg: string) => {
    showToastRef.current(msg);
    if (navigator.vibrate) navigator.vibrate(50);
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      try { new Notification('🎬 Cinema sync', { body: msg, silent: true }); } catch { /* ignore */ }
    }
  };

  // ✅ externalSyncEvent is now always a fresh object (stamped with receivedAt)
  //    so this effect reliably fires for every incoming event.
  useEffect(() => {
    console.log('[embed] effect fired, externalSyncEvent:', externalSyncEvent);
    if (!externalSyncEvent) return;

    const time = externalSyncEvent.currentTime > 0
      ? ` at ${formatTime(externalSyncEvent.currentTime)}`
      : '';
    const msg = externalSyncEvent.action === 'play'
      ? `Partner played${time}`
      : `Partner paused${time}`;
    notify(msg);
  // receivedAt is the stable trigger; the rest are read inside but don't need
  // to be deps because notify/formatTime are module-stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSyncEvent]);

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  return (
    <div className="relative w-full bg-background">
      <iframe
        src={src}
        className={`w-full ${className ?? ''}`}
        allowFullScreen
        title={title || 'Video player'}
        allow="autoplay; fullscreen"
      />

      {/* Sync overlay — floats above the player controls area */}
      <div className="mt-2 flex items-center gap-2 px-1 flex-wrap bg-transparent py-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sync:</span>
        <Button
          type="button"
          onClick={() => {
            onPlaybackChange?.('play', 0);
            void sendPushNotification('Partner played', { url: '/cinema', senderId: currentUserId });
          }}
        >
          <Play className="h-3 w-3" />
          I played
        </Button>

        <Button
          type="button"
          onClick={() => {
            onPlaybackChange?.('pause', 0);
            void sendPushNotification('Partner paused', { url: '/cinema', senderId: currentUserId });
          }}
        >
          <Pause className="h-3 w-3" />
          I paused
        </Button>

        {externalSyncEvent && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-primary fixed top-2">
            {externalSyncEvent.action === 'play'
              ? <Play className="h-3 w-3" />
              : <Pause className="h-3 w-3" />}
            Partner {externalSyncEvent.action === 'play' ? 'played' : 'paused'}
            {externalSyncEvent.currentTime > 0 && (
              <span className="text-muted-foreground">
                at {formatTime(externalSyncEvent.currentTime)}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Fixed toast — visible even during fullscreen on Safari/iOS */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-9999 pointer-events-none">
          <div className="flex items-center gap-2 rounded-full bg-black/80 backdrop-blur-sm px-4 py-2 text-sm text-white shadow-xl">
            <img src="/animated_heart_icon.svg" alt="" className="h-4 w-4" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function TuniflixEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
  currentUserId,
  // ✅ Accept the shared senderId from useCinemaSync so both the hook and
  //    the YouTube sub-player use the same identity for self-filtering.
  senderId,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
  currentUserId?: string;
  senderId?: string;
}) {
  // Fall back to a local ID only when the parent doesn't supply one.
  const senderIdRef = useRef(
    senderId ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `embed-${Math.random().toString(36).slice(2)}`)
  );

  // Keep the ref in sync if the parent-supplied senderId changes (shouldn't,
  // but guards against edge-cases like HMR).
  useEffect(() => {
    if (senderId) senderIdRef.current = senderId;
  }, [senderId]);

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
    <GenericEmbedPlayer
      src={src}
      title={title}
      className={className}
      externalSyncEvent={externalSyncEvent}
      onPlaybackChange={onPlaybackChange}
      currentUserId={currentUserId}
    />
  );
}