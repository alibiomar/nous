'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/client';
import { Button } from '@/components/ui/button';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { Film, Loader2, Music, Plus, Maximize2, Play, Search, Square, X } from 'lucide-react';
import { parseYouTubeUrl } from '@/lib/youtube';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MediaItem {
  id: string;
  url: string;
  title: string;
  type: 'music' | 'video';
  platform: string;
  created_at: string;
  added_by?: {
    id: string;
    name: string;
  };
}

type PlaybackAction = 'play' | 'pause';

interface PlaybackSyncPayload {
  senderId: string;
  mediaId: string;
  action: PlaybackAction;
  currentTime: number;
  happenedAt: number;
}

interface YouTubePlayerStateChangeEvent {
  data: number;
}

interface YouTubePlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  unMute: () => void;
}

interface YouTubePlayerOptions {
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: () => void;
    onStateChange?: (event: YouTubePlayerStateChangeEvent) => void;
  };
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: {
    PLAYING: number;
    PAUSED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}
// ─── YouTube search result ────────────────────────────────────────────────────
interface YTSearchResult {
  videoId:      string;
  title:        string;
  channelTitle: string;
  thumbnail:    string;
  durationSec:  number;
}
// ─── YouTube API Loader ───────────────────────────────────────────────────────

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        youtubeApiPromise = null;
        reject(new Error('YouTube API loaded without player namespace'));
      }
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        youtubeApiPromise = null;
        reject(new Error('Failed to load YouTube API script'));
      };
      document.body.appendChild(script);
    }
  });

  return youtubeApiPromise;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

function isPlaybackSyncPayload(payload: unknown): payload is PlaybackSyncPayload {
  if (!payload || typeof payload !== 'object') return false;
  const c = payload as Record<string, unknown>;
  return (
    typeof c.senderId === 'string' &&
    typeof c.mediaId === 'string' &&
    (c.action === 'play' || c.action === 'pause') &&
    typeof c.currentTime === 'number' &&
    typeof c.happenedAt === 'number'
  );
}

// ─── safeDestroyPlayer ───────────────────────────────────────────────────────

function safeDestroyPlayer(player: YouTubePlayer | null) {
  if (!player) return;
  try {
    player.destroy();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
      throw error;
    }
  }
}

// ─── useSupabase ──────────────────────────────────────────────────────────────

function useSupabase(): SupabaseClient {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createClient(), []);
}

// ─── GlobalMediaPlayer ───────────────────────────────────────────────────────

export function GlobalMediaPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const isMusicPage = pathname === '/music';
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth');

  const supabase = useSupabase();

  const [currentMedia, setCurrentMedia] = useState<MediaItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isMiniPlaying, setIsMiniPlaying] = useState(true);
  const [miniPosition, setMiniPosition] = useState<{ x: number; y: number } | null>(null);
  const [externalSyncEvent, setExternalSyncEvent] = useState<PlaybackSyncPayload | null>(null);

  const syncChannelRef = useRef<RealtimeChannel | null>(null);
  const miniContainerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    moved: boolean;
  } | null>(null);
  const suppressMiniClickRef = useRef(false);
  const playerCurrentTimeRef = useRef(0);

  const syncClientIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}`
  );

  // ── Fetch current media ────────────────────────────────────────────────────

  const fetchCurrentMedia = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/media/now-playing', { signal });
      if (signal?.aborted) return;

      if (!response.ok) {
        setCurrentMedia(null);
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setCurrentMedia(null);
        return;
      }

      const data = (await response.json()) as MediaItem | null;
      if (!signal?.aborted) {
        setCurrentMedia(data);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('Failed to fetch current media:', error);
      if (!signal?.aborted) setCurrentMedia(null);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  // ── Subscribe to media table changes ──────────────────────────────────────

  useEffect(() => {
    if (isAuthRoute) return;

    const controller = new AbortController();
    fetchCurrentMedia(controller.signal);

    const channel = supabase
      .channel('media-now-playing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media' }, () => {
        fetchCurrentMedia();
      })
      .subscribe();

    return () => {
      controller.abort();
      supabase.removeChannel(channel);
    };
  }, [isAuthRoute, supabase, fetchCurrentMedia]);

  // ── Subscribe to playback-sync broadcasts ─────────────────────────────────

  useEffect(() => {
    if (isAuthRoute) return;

    const channel = supabase
      .channel('media-playback-sync')
      .on('broadcast', { event: 'playback' }, (message: { payload: unknown }) => {
        if (!isPlaybackSyncPayload(message.payload)) return;
        if (message.payload.senderId === syncClientIdRef.current) return;
        setExternalSyncEvent(message.payload);
      })
      .subscribe();

    syncChannelRef.current = channel;

    return () => {
      syncChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [isAuthRoute, supabase]);

  // ── Reset ephemeral state when the active track changes ───────────────────

  useEffect(() => {
    setExternalSyncEvent(null);
    setIsMiniPlaying(true);
    playerCurrentTimeRef.current = 0;
  }, [currentMedia?.id]);

  // ── Position the mini player (bottom-right, clamped to viewport) ──────────

  useEffect(() => {
    if (typeof window === 'undefined' || isMusicPage) return;

    const clamp = () => {
      if (!miniContainerRef.current) return;
      const width = miniContainerRef.current.offsetWidth || 120;
      const height = miniContainerRef.current.offsetHeight || 64;
      const margin = 16;

      setMiniPosition((prev) => {
        const defaultX = Math.max(margin, window.innerWidth - width - margin);
        const defaultY = Math.max(margin, window.innerHeight - height - 84);
        if (!prev) return { x: defaultX, y: defaultY };
        return {
          x: Math.min(Math.max(prev.x, margin), Math.max(margin, window.innerWidth - width - margin)),
          y: Math.min(Math.max(prev.y, margin), Math.max(margin, window.innerHeight - height - margin)),
        };
      });
    };

    const frameId = window.requestAnimationFrame(clamp);
    window.addEventListener('resize', clamp);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', clamp);
    };
  }, [currentMedia?.id, isMusicPage]);

  // ── Reflect remote sync events onto local playing state ───────────────────

  useEffect(() => {
    if (!externalSyncEvent || externalSyncEvent.mediaId !== currentMedia?.id) return;
    setIsMiniPlaying(externalSyncEvent.action === 'play');
  }, [externalSyncEvent, currentMedia?.id]);

  // ── Broadcast a local playback change to the sync channel ─────────────────

  const handlePlaybackChange = useCallback(
    async (action: PlaybackAction, currentTime: number, mediaId: string) => {
      const channel = syncChannelRef.current;
      if (!channel) return;
      await channel.send({
        type: 'broadcast',
        event: 'playback',
        payload: {
          senderId: syncClientIdRef.current,
          mediaId,
          action,
          currentTime,
          happenedAt: Date.now(),
        } satisfies PlaybackSyncPayload,
      });
    },
    []
  );

  // ── Mini-player toggle (play/pause) ───────────────────────────────────────

  const handleMiniToggle = useCallback(async () => {
    if (suppressMiniClickRef.current) {
      suppressMiniClickRef.current = false;
      return;
    }
    if (!currentMedia) return;

    const nextAction: PlaybackAction = isMiniPlaying ? 'pause' : 'play';
    setIsMiniPlaying(nextAction === 'play');

    const currentTime = playerCurrentTimeRef.current;

    setExternalSyncEvent({
      senderId: syncClientIdRef.current,
      mediaId: currentMedia.id,
      action: nextAction,
      currentTime,
      happenedAt: Date.now(),
    });

    await handlePlaybackChange(nextAction, currentTime, currentMedia.id);
  }, [currentMedia, handlePlaybackChange, isMiniPlaying]);

  // ── Open full player ───────────────────────────────────────────────────────

  const handleOpenFullPlayer = useCallback(() => {
    if (suppressMiniClickRef.current) {
      suppressMiniClickRef.current = false;
      return;
    }
    router.push('/music');
  }, [router]);

  // ── Drag-to-reposition mini player ────────────────────────────────────────

  const handleMiniPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isMusicPage || !miniPosition) return;

      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        initialX: miniPosition.x,
        initialY: miniPosition.y,
        moved: false,
      };

      const onPointerMove = (e: PointerEvent) => {
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;

        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;

        if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          drag.moved = true;
          suppressMiniClickRef.current = true;
        }
        if (!drag.moved || !miniContainerRef.current) return;

        const width = miniContainerRef.current.offsetWidth || 120;
        const height = miniContainerRef.current.offsetHeight || 64;
        const margin = 8;

        setMiniPosition({
          x: Math.min(Math.max(drag.initialX + dx, margin), Math.max(margin, window.innerWidth - width - margin)),
          y: Math.min(Math.max(drag.initialY + dy, margin), Math.max(margin, window.innerHeight - height - margin)),
        });
      };

      const onPointerUp = (e: PointerEvent) => {
        if (!dragStateRef.current || dragStateRef.current.pointerId !== e.pointerId) return;
        dragStateRef.current = null;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [isMusicPage, miniPosition]
  );

  const parsedYouTube = useMemo(
    () => (currentMedia ? parseYouTubeUrl(currentMedia.url) : null),
    [currentMedia]
  );

  if (isAuthRoute) return null;
  if (!isMusicPage && !currentMedia && !isLoading) return null;

  // FIX 1: Lower the z-index to z-10 for the full page container, making it sit BEHIND the z-30 navigation bars.
  // We use `inset-0` instead of calculating top/bottom limits so the scroll stretches behind transparent navs.
  const containerClasses = isMusicPage
    ? 'fixed inset-0 md:left-72 z-10 overflow-y-auto bg-transparent'
    : 'fixed z-50';

  return (
    <>
      <div
        className={containerClasses}
        style={
          isMusicPage || !miniPosition
            ? undefined
            : { left: miniPosition.x, top: miniPosition.y }
        }
      >
        {/* FIX 2: We use padding (pt-24 pb-32) so content isn't obscured by the overlapping glass navigation */}
        <div className={isMusicPage ? 'mx-auto w-full max-w-6xl px-4 pt-24 pb-32 md:px-8 md:py-8' : 'w-full'}>

          {/* ── Music page header ── */}
          {isMusicPage && (
            <>
                    <div className="glass-panel mb-6 relative overflow-hidden rounded-3xl border border-border/70 p-5 md:p-7">
                <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-secondary/60 blur-2xl" />

                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Shared listening room</p>
                <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground md:text-4xl">Media</h1>
                <p className="mt-2 text-sm text-text-secondary md:text-base">Share YouTube videos and playlists in sync.</p>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  {[
                    { label: 'Room mode', value: 'Synchronized playback' },
                    { label: 'Source', value: 'YouTube video or playlist' },
                    { label: 'Status', value: 'Live and collaborative' },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => setShowAddModal(true)}
                className="mb-6 h-12 w-full gap-2 rounded-2xl font-medium"
              >
                <Plus className="w-5 h-5" />
                Share YouTube
              </Button>
            </>
          )}

          {/* ── Mini player (floating bubble) ── */}
          {!isMusicPage && currentMedia && (
            <div
              ref={miniContainerRef}
              className="flex items-center gap-2 cursor-grab active:cursor-grabbing select-none"
              onPointerDown={handleMiniPointerDown}
              style={{ touchAction: 'none' }}
            >
              <button
                type="button"
                onClick={handleMiniToggle}
                className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center transition-transform hover:scale-105"
                title={isMiniPlaying ? 'Pause' : 'Play'}
                aria-label={isMiniPlaying ? 'Pause playback' : 'Resume playback'}
              >
                {isMiniPlaying ? <Square className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={handleOpenFullPlayer}
                className="h-10 w-10 rounded-full bg-card border border-border text-foreground shadow-lg flex items-center justify-center hover:bg-secondary transition-colors"
                title="Open full player"
                aria-label="Open full player"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Full page: loading skeleton ── */}
          {isLoading && isMusicPage && (
            <div className="glass-panel rounded-3xl p-12 text-center">
              <p className="text-text-secondary">Loading media...</p>
            </div>
          )}

          {/* ── Full page: media info card ── */}
          {!isLoading && currentMedia && isMusicPage && (
            <div className="glass-panel border border-border/70 -z-10 overflow-hidden rounded-t-3xl">
              <div className="p-4 flex items-center gap-3 md:p-6 md:gap-4 md:items-start border-b border-border">
                <div className="hidden md:flex w-20 h-20 rounded-lg bg-linear-to-br from-primary to-primary/70 items-center justify-center shrink-0">
                  <Film className="w-10 h-10 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif font-semibold text-foreground leading-tight wrap-break-word text-2xl">
                    {currentMedia.title}
                  </p>

                  {currentMedia.added_by && (
                    <p className="text-text-tertiary text-xs mt-2">
                      Added by{' '}
                      <span className="text-text-secondary font-medium">{currentMedia.added_by.name}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Full page: empty state ── */}
          {!isLoading && !currentMedia && isMusicPage && (
            <div className="glass-panel rounded-3xl p-12 text-center">
              <p className="text-text-secondary mb-2">No media playing yet</p>
              <p className="text-sm text-text-tertiary">Click "Share YouTube" to add content</p>
            </div>
          )}

          {/* ── YouTube player (persistent across routes, hidden when mini) ── */}
          {currentMedia && parsedYouTube && (
            <div
              className={
                isMusicPage
                  ? 'glass-panel border border-t-0 border-border/70 z-10 overflow-hidden rounded-b-3xl'
                  : 'absolute overflow-hidden pointer-events-none'
              }
              style={isMusicPage ? undefined : { left: -10000, top: 0, height: 1, width: 1 }}
            >
              <YouTubeSyncPlayer
                mediaId={currentMedia.id}
                parsedUrl={parsedYouTube}
                syncEvent={externalSyncEvent}
                onPlaybackChange={handlePlaybackChange}
                currentTimeRef={playerCurrentTimeRef}
                isMusicPage={isMusicPage}
                className={isMusicPage ? 'w-full z-10' : 'h-px w-px'}
              />
            </div>
          )}

          {/* ── Invalid URL fallback ── */}
          {currentMedia && !parsedYouTube && isMusicPage && (
            <div className="glass-panel border border-t-0 border-border/70 rounded-b-3xl p-6">
              <p className="text-sm text-text-secondary text-center">Invalid YouTube URL.</p>
            </div>
          )}
        </div>
      </div>

      {/* FIX 3: We moved the AddMediaModal OUTSIDE the player container. 
          This breaks it out of the new z-10 stacking context so it can safely overlay the z-30 Navigation. */}
      {showAddModal && isMusicPage && (
        <AddMediaModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchCurrentMedia();
          }}
        />
      )}
    </>
  );
}

// ─── YouTubeSyncPlayer ────────────────────────────────────────────────────────

function YouTubeSyncPlayer({
  mediaId,
  parsedUrl,
  syncEvent,
  onPlaybackChange,
  currentTimeRef,
  isMusicPage,
  className,
}: {
  mediaId: string;
  parsedUrl: { videoId: string | null; playlistId: string | null };
  syncEvent: PlaybackSyncPayload | null;
  onPlaybackChange: (action: PlaybackAction, currentTime: number, mediaId: string) => Promise<void>;
  currentTimeRef: React.MutableRefObject<number>;
  isMusicPage: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const ytRef = useRef<YouTubeNamespace | null>(null);
  const applyingRemoteSyncRef = useRef(false);
  const isPlayingRef = useRef(false);
  const hiddenAutoPausedRef = useRef(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setPlayerError(null);
    isPlayingRef.current = false;
    hiddenAutoPausedRef.current = false;

    loadYouTubeApi()
      .then((yt) => {
        if (cancelled || !containerRef.current) return;

        ytRef.current = yt;
        safeDestroyPlayer(playerRef.current);
        playerRef.current = null;

        playerRef.current = new yt.Player(containerRef.current, {
          videoId: parsedUrl.videoId ?? undefined,
          playerVars: {
            autoplay: 0,
            controls: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            ...(parsedUrl.playlistId ? { list: parsedUrl.playlistId } : {}),
            ...(!parsedUrl.videoId && parsedUrl.playlistId ? { listType: 'playlist' } : {}),
          },
          events: {
            onStateChange: async (event) => {
              if (applyingRemoteSyncRef.current || !playerRef.current || !ytRef.current) return;

              const currentTime = playerRef.current.getCurrentTime();
              currentTimeRef.current = currentTime;

              if (event.data === ytRef.current.PlayerState.PLAYING) {
                isPlayingRef.current = true;
                hiddenAutoPausedRef.current = false;
                await onPlaybackChange('play', currentTime, mediaId);
                return;
              }

              if (event.data === ytRef.current.PlayerState.PAUSED) {
                if (document.hidden && isPlayingRef.current) {
                  hiddenAutoPausedRef.current = true;
                  playerRef.current.unMute?.();
                  playerRef.current.playVideo();
                  return;
                }

                isPlayingRef.current = false;
                await onPlaybackChange('pause', currentTime, mediaId);
              }
            },
          },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setPlayerError(error instanceof Error ? error.message : 'Unable to load YouTube player');
      });

    return () => {
      cancelled = true;
      isPlayingRef.current = false;
      hiddenAutoPausedRef.current = false;
      safeDestroyPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, [parsedUrl.videoId, parsedUrl.playlistId, mediaId, onPlaybackChange]);

  useEffect(() => {
    const handleVisibility = () => {
      const player = playerRef.current;
      if (!player) return;

      if (document.hidden && isPlayingRef.current) {
        player.unMute?.();
        player.playVideo();
      } else if (!document.hidden && hiddenAutoPausedRef.current) {
        hiddenAutoPausedRef.current = false;
        player.unMute?.();
        player.playVideo();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!syncEvent || syncEvent.mediaId !== mediaId || !playerRef.current) return;
    if (typeof playerRef.current.seekTo !== 'function') return;

    const safeTime = Number.isFinite(syncEvent.currentTime) ? Math.max(syncEvent.currentTime, 0) : 0;

    applyingRemoteSyncRef.current = true;

    const delta = Math.abs(playerRef.current.getCurrentTime() - safeTime);
    if (delta > 2) {
      playerRef.current.seekTo(safeTime, true);
    }

    if (syncEvent.action === 'play') {
      isPlayingRef.current = true;
      hiddenAutoPausedRef.current = false;
      playerRef.current.unMute?.();
      playerRef.current.playVideo();
    } else {
      isPlayingRef.current = false;
      hiddenAutoPausedRef.current = false;
      playerRef.current.pauseVideo();
    }

    const timeout = window.setTimeout(() => {
      applyingRemoteSyncRef.current = false;
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [syncEvent, mediaId]);

  if (playerError) {
    return (
      <div className={`w-full flex items-center justify-center p-6 ${isMusicPage ? 'h-96' : 'h-48'}`}>
        <p className="text-sm text-text-secondary text-center">{playerError}</p>
      </div>
    );
  }

  return <div ref={containerRef} className={className ?? `w-full  ${isMusicPage ? 'h-screen' : 'h-48'}`} />;
}

// ─── AddMediaModal ────────────────────────────────────────────────────────────

function AddMediaModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<YTSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [picked, setPicked]       = useState<YTSearchResult | null>(null);
  const [isAdding, setIsAdding]   = useState(false);
  const [addError, setAddError]   = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 
  const handleQueryChange = (val: string) => {
    setQuery(val);
    setSearchErr('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/youtube/search?q=${encodeURIComponent(val.trim())}`);
        const data = await res.json();
        if (!res.ok) { setSearchErr(data.error ?? 'Search failed'); setResults([]); }
        else setResults(Array.isArray(data) ? data : []);
      } catch { setSearchErr('Search failed'); }
      finally { setSearching(false); }
    }, 500);
  };
 
  const fmtSec = (s: number) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
 
  const handleAdd = async () => {
    if (!picked) return;
    setAddError(''); setIsAdding(true);
    try {
      const url = `https://www.youtube.com/watch?v=${picked.videoId}`;
      const res = await fetch('/api/media/now-playing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: picked.title }),
      });
      if (res.ok) { onSuccess(); }
      else {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setAddError(d.error ?? 'Failed to add media');
      }
    } catch { setAddError('Something went wrong. Please try again.'); }
    finally { setIsAdding(false); }
  };
 
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isAdding) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdding, onClose]);
 
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
      onClick={e => { if (e.target === e.currentTarget && !isAdding) onClose(); }}
    >
      <div className="glass-panel-strong w-full sm:max-w-md overflow-hidden rounded-t-3xl sm:rounded-3xl border border-border/70 max-h-[85vh] flex flex-col">
 
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-border/60 bg-primary/10 p-2">
              <Music className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Share Music</h2>
              <p className="text-xs text-muted-foreground">Search any song or artist</p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
 
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {!picked && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                placeholder="Song name, artist, lyrics…"
                className="w-full h-11 rounded-2xl border border-border/70 bg-background/60 pl-9 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
              )}
            </div>
          )}
 
          {searchErr && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{searchErr}</p>
          )}
 
          {results.length > 0 && !picked && (
            <div className="space-y-1.5">
              {results.map(v => (
                <button key={v.videoId} type="button" onClick={() => { setPicked(v); setResults([]); setQuery(''); }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/50 p-2.5 text-left hover:bg-muted/40 transition-colors">
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt="" className="h-12 w-20 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="h-12 w-20 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                      <Music className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground line-clamp-1">{v.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{v.channelTitle}</p>
                    {v.durationSec > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{fmtSec(v.durationSec)}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
 
          {picked && (
            <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/8 p-2.5">
              {picked.thumbnail ? (
                <img src={picked.thumbnail} alt="" className="h-12 w-20 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="h-12 w-20 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                  <Music className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground line-clamp-1">{picked.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{picked.channelTitle}</p>
                {picked.durationSec > 0 && (
                  <p className="text-xs text-muted-foreground/60">{fmtSec(picked.durationSec)}</p>
                )}
              </div>
              <button type="button" onClick={() => setPicked(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
 
          {addError && (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{addError}</p>
          )}
 
          {!picked && results.length === 0 && !searching && !searchErr && (
            <div className="text-center py-8">
              <Music className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/50">Search for a song to share</p>
            </div>
          )}
        </div>
 
        <div className="flex gap-3 px-5 pt-4 pb-8 sm:pb-4 border-t border-border/60 shrink-0">
          <Button onClick={onClose} variant="outline" className="flex-1 rounded-2xl" disabled={isAdding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!picked || isAdding} className="flex-1 rounded-2xl gap-1.5">
            {isAdding ? (
              <><img src="/animated_heart_icon.svg" alt="" className="h-4 w-4" />Adding…</>
            ) : (
              <><Music className="h-4 w-4" />Play now</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}