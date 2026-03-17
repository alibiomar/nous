'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/client';
import { Button } from '@/components/ui/button';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { Film, Plus, Maximize2, Play, Square } from 'lucide-react';
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

// ─── YouTube API Loader ───────────────────────────────────────────────────────

// Module-level singleton so we load the script once across HMR/remounts.
let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        // Reset so a retry is possible on failure.
        youtubeApiPromise = null;
        reject(new Error('YouTube API loaded without player namespace'));
      }
    };

    // Only inject the script if it isn't already in the DOM.
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
    // Ignore NotFoundError — the DOM node was already removed.
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
      throw error;
    }
  }
}

// ─── useSupabase ──────────────────────────────────────────────────────────────

/**
 * Returns a stable Supabase client instance. createClient() must not be called
 * on every render because it creates a new WebSocket connection each time.
 */
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
  // Suppresses the click handler that fires immediately after a drag ends.
  const suppressMiniClickRef = useRef(false);

  // Written by YouTubeSyncPlayer on every state-change event so the parent
  // always has an accurate timestamp when it needs to build a sync payload.
  const playerCurrentTimeRef = useRef(0);

  // Stable client ID for the lifetime of this component instance.
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
        // Ignore our own broadcasts.
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
    // Drag just ended — swallow this synthetic click.
    if (suppressMiniClickRef.current) {
      suppressMiniClickRef.current = false;
      return;
    }
    if (!currentMedia) return;

    const nextAction: PlaybackAction = isMiniPlaying ? 'pause' : 'play';
    setIsMiniPlaying(nextAction === 'play');

    // Read the actual player position so the peer seeks to the right place.
    const currentTime = playerCurrentTimeRef.current;

    // Drive the embedded player via the same sync pathway as a remote event.
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

        // If no movement occurred, suppressMiniClickRef was never set, so the
        // click handler (toggle/open) will fire normally.
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

  // ── Derived ────────────────────────────────────────────────────────────────

  const parsedYouTube = useMemo(
    () => (currentMedia ? parseYouTubeUrl(currentMedia.url) : null),
    [currentMedia]
  );

  // ── Early exits ───────────────────────────────────────────────────────────

  if (isAuthRoute) return null;
  if (!isMusicPage && !currentMedia && !isLoading) return null;

  // ── Layout ────────────────────────────────────────────────────────────────

  const containerClasses = isMusicPage
    ? 'fixed top-20 md:top-0 left-0 md:left-72 right-0 bottom-[80px] md:bottom-0 z-10 overflow-y-auto bg-transparent'
    : 'fixed z-50';

  return (
    <div
      className={containerClasses}
      style={
        isMusicPage || !miniPosition
          ? undefined
          : { left: miniPosition.x, top: miniPosition.y }
      }
    >
      <div className={isMusicPage ? 'mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8' : 'w-full'}>

        {/* ── Music page header ── */}
        {isMusicPage && (
          <>
            <div className="glass-panel mb-6 rounded-3xl p-5 md:p-7">
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
          <div className="glass-panel border border-border/70 overflow-hidden rounded-t-3xl">
            <div className="p-4 flex items-center gap-3 md:p-6 md:gap-4 md:items-start border-b border-border">
              <div className="hidden md:flex w-20 h-20 rounded-lg bg-linear-to-br from-primary to-primary/70 items-center justify-center shrink-0">
                <Film className="w-10 h-10 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-serif font-semibold text-foreground leading-tight wrap-break-word text-2xl">
                  {currentMedia.title}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-block px-2 py-1 bg-primary/10 text-primary text-xs font-medium rounded">
                    Video
                  </span>
                  <p className="text-sm text-text-secondary capitalize font-medium">YouTube</p>
                </div>
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
                ? 'glass-panel border border-t-0 border-border/70 overflow-hidden rounded-b-3xl'
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
              className={isMusicPage ? 'w-full h-96' : 'h-px w-px'}
            />
          </div>
        )}

        {/* ── Invalid URL fallback ── */}
        {currentMedia && !parsedYouTube && isMusicPage && (
          <div className="glass-panel border border-t-0 border-border/70 rounded-b-3xl p-6">
            <p className="text-sm text-text-secondary text-center">Invalid YouTube URL.</p>
          </div>
        )}

        {/* ── Add-media modal ── */}
        {showAddModal && isMusicPage && (
          <AddMediaModal
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              fetchCurrentMedia();
            }}
          />
        )}
      </div>
    </div>
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
  /** Written on every state-change so the parent always has the live position. */
  currentTimeRef: React.MutableRefObject<number>;
  isMusicPage: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const ytRef = useRef<YouTubeNamespace | null>(null);
  // Prevents the player's own state-change events from being re-broadcast while
  // we are applying a remote sync command.
  const applyingRemoteSyncRef = useRef(false);
  const isPlayingRef = useRef(false);
  // True when the browser backgrounded the tab and auto-paused the player.
  const hiddenAutoPausedRef = useRef(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // ── Initialise / reinitialise the YT player ───────────────────────────────

  useEffect(() => {
    let cancelled = false;

    // Reset error and playback tracking on every new video.
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
              // Always keep the parent's ref up-to-date so it can build accurate
              // sync payloads without needing to call into the player directly.
              currentTimeRef.current = currentTime;

              if (event.data === ytRef.current.PlayerState.PLAYING) {
                isPlayingRef.current = true;
                hiddenAutoPausedRef.current = false;
                await onPlaybackChange('play', currentTime, mediaId);
                return;
              }

              if (event.data === ytRef.current.PlayerState.PAUSED) {
                // Background-tab auto-pause — keep playing silently; do not
                // broadcast a pause event to the other party.
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
  // onPlaybackChange is stable (useCallback with no deps in parent) so it's
  // safe to include; changing videoId/playlistId/mediaId recreates the player.
  }, [parsedUrl.videoId, parsedUrl.playlistId, mediaId, onPlaybackChange]);

  // ── Restore playback after a tab-visibility change ────────────────────────

  useEffect(() => {
    const handleVisibility = () => {
      const player = playerRef.current;
      if (!player) return;

      if (document.hidden && isPlayingRef.current) {
        // Some browsers (iOS Safari) autopause on hide — proactively resume.
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

  // ── Apply remote sync commands ────────────────────────────────────────────

  useEffect(() => {
    if (!syncEvent || syncEvent.mediaId !== mediaId || !playerRef.current) return;
    if (typeof playerRef.current.seekTo !== 'function') return;

    const safeTime = Number.isFinite(syncEvent.currentTime) ? Math.max(syncEvent.currentTime, 0) : 0;

    applyingRemoteSyncRef.current = true;

    // Avoid seeking if we're already within 2 s to prevent disruptive jumps
    // during normal play → pause → play cycles where currentTime is 0.
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (playerError) {
    return (
      <div className={`w-full flex items-center justify-center p-6 ${isMusicPage ? 'h-96' : 'h-48'}`}>
        <p className="text-sm text-text-secondary text-center">{playerError}</p>
      </div>
    );
  }

  return <div ref={containerRef} className={className ?? `w-full ${isMusicPage ? 'h-96' : 'h-48'}`} />;
}

// ─── AddMediaModal ────────────────────────────────────────────────────────────

function AddMediaModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async () => {
    setError('');
    if (!url.trim()) {
      setError('Please enter a media URL');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/media/now-playing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? 'Failed to add media');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [url, onSuccess]);

  // Allow submitting with Enter.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && url.trim() && !isLoading) {
        handleSubmit();
      }
    },
    [url, isLoading, handleSubmit]
  );

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLoading, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}
    >
      <div className="glass-panel-strong w-full max-w-md overflow-hidden rounded-3xl border border-border/70">
        {/* Header */}
        <div className="p-6 border-b border-border/70 bg-background/60">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Share Media</h2>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="media-url" className="block text-sm font-medium text-foreground mb-2">
              Link
            </label>
            <input
              id="media-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste a YouTube video or playlist URL…"
              className="w-full px-4 py-2 bg-background/70 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-text-tertiary"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {error && (
            <div role="alert" className="p-3 bg-error/10 text-error text-sm rounded-lg font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button onClick={onClose} variant="outline" className="flex-1" disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!url.trim() || isLoading} className="flex-1">
            {isLoading ? (
              <>
                <img src="/animated_heart_icon.svg" alt="" aria-hidden="true" className="w-4 h-4 mr-2" />
                Adding…
              </>
            ) : (
              'Add Media'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}