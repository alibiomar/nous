'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/client';
import { Button } from '@/components/ui/button';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Film, Plus, Loader2, Maximize2, Play, Square } from 'lucide-react';
import { parseYouTubeUrl } from '@/lib/youtube';

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

function safeDestroyPlayer(player: YouTubePlayer | null) {
  if (!player) {
    return;
  }

  try {
    player.destroy();
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      error.name !== 'NotFoundError'
    ) {
      throw error;
    }
  }
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    const previousReadyHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();

      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube API loaded without player namespace'));
      }
    };

    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load YouTube API'));
    document.body.appendChild(script);
  });

  return youtubeApiPromise;
}

function isPlaybackSyncPayload(payload: unknown): payload is PlaybackSyncPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.senderId === 'string' &&
    typeof candidate.mediaId === 'string' &&
    (candidate.action === 'play' || candidate.action === 'pause') &&
    typeof candidate.currentTime === 'number' &&
    typeof candidate.happenedAt === 'number'
  );
}

export function GlobalMediaPlayer() {
  const pathname = usePathname();
  const router = useRouter();
  const isMusicPage = pathname === '/music';
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth');

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
  const syncClientIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `client-${Math.random().toString(36).slice(2)}`
  );
  const supabase = createClient();

  useEffect(() => {
    if (isAuthRoute) {
      return;
    }

    fetchCurrentMedia();

    const channel = supabase
      .channel('media-now-playing')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'media' },
        () => {
          fetchCurrentMedia();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthRoute, supabase]);

  useEffect(() => {
    if (isAuthRoute) {
      return;
    }

    const channel = supabase
      .channel('media-playback-sync')
      .on('broadcast', { event: 'playback' }, (message: { payload: unknown }) => {
        if (!isPlaybackSyncPayload(message.payload)) {
          return;
        }

        if (message.payload.senderId === syncClientIdRef.current) {
          return;
        }

        setExternalSyncEvent(message.payload);
      })
      .subscribe();

    syncChannelRef.current = channel;

    return () => {
      syncChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [isAuthRoute, supabase]);

  useEffect(() => {
    setExternalSyncEvent(null);
    setIsMiniPlaying(true);
  }, [currentMedia?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const placeMiniPlayer = () => {
      if (!miniContainerRef.current) {
        return;
      }

      const width = miniContainerRef.current.offsetWidth || 120;
      const height = miniContainerRef.current.offsetHeight || 64;
      const margin = 16;

      setMiniPosition((prev) => {
        if (!prev) {
          return {
            x: Math.max(margin, window.innerWidth - width - margin),
            y: Math.max(margin, window.innerHeight - height - 84),
          };
        }

        return {
          x: Math.min(Math.max(prev.x, margin), Math.max(margin, window.innerWidth - width - margin)),
          y: Math.min(Math.max(prev.y, margin), Math.max(margin, window.innerHeight - height - margin)),
        };
      });
    };

    // Re-run once the mini player exists (after media is loaded) so initial position is set.
    const frameId = window.requestAnimationFrame(placeMiniPlayer);
    window.addEventListener('resize', placeMiniPlayer);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', placeMiniPlayer);
    };
  }, [currentMedia?.id, isMusicPage]);

  useEffect(() => {
    if (!externalSyncEvent || externalSyncEvent.mediaId !== currentMedia?.id) {
      return;
    }

    setIsMiniPlaying(externalSyncEvent.action === 'play');
  }, [externalSyncEvent, currentMedia?.id]);

  const fetchCurrentMedia = async () => {
    try {
      const response = await fetch('/api/media/now-playing');

      if (!response.ok) {
        setCurrentMedia(null);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        setCurrentMedia(null);
        return;
      }

      const data = await response.json();
      setCurrentMedia(data);
    } catch (error) {
      console.error('Failed to fetch media:', error);
      setCurrentMedia(null);
    } finally {
      setIsLoading(false);
    }
  };

  const parsedYouTube = currentMedia ? parseYouTubeUrl(currentMedia.url) : null;
  const handlePlaybackChange = useCallback(
    async (action: PlaybackAction, currentTime: number, mediaId: string) => {
      const channel = syncChannelRef.current;
      if (!channel) {
        return;
      }

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

  const handleMiniToggle = useCallback(async () => {
    if (suppressMiniClickRef.current) {
      suppressMiniClickRef.current = false;
      return;
    }

    if (!currentMedia) {
      return;
    }

    const nextAction: PlaybackAction = isMiniPlaying ? 'pause' : 'play';
    setIsMiniPlaying(nextAction === 'play');

    setExternalSyncEvent({
      senderId: syncClientIdRef.current,
      mediaId: currentMedia.id,
      action: nextAction,
      currentTime: 0,
      happenedAt: Date.now(),
    });

    await handlePlaybackChange(nextAction, 0, currentMedia.id);
  }, [currentMedia, handlePlaybackChange, isMiniPlaying]);

  const handleOpenFullPlayer = useCallback(() => {
    if (suppressMiniClickRef.current) {
      suppressMiniClickRef.current = false;
      return;
    }

    router.push('/music');
  }, [router]);

  const handleMiniPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (isMusicPage || !miniPosition) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: miniPosition.x,
      initialY: miniPosition.y,
      moved: false,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!dragStateRef.current || dragStateRef.current.pointerId !== moveEvent.pointerId) {
        return;
      }

      const deltaX = moveEvent.clientX - dragStateRef.current.startX;
      const deltaY = moveEvent.clientY - dragStateRef.current.startY;

      if (!dragStateRef.current.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        dragStateRef.current.moved = true;
        suppressMiniClickRef.current = true;
      }

      if (!dragStateRef.current.moved || !miniContainerRef.current) {
        return;
      }

      const width = miniContainerRef.current.offsetWidth || 120;
      const height = miniContainerRef.current.offsetHeight || 64;
      const margin = 8;

      setMiniPosition({
        x: Math.min(
          Math.max(dragStateRef.current.initialX + deltaX, margin),
          Math.max(margin, window.innerWidth - width - margin)
        ),
        y: Math.min(
          Math.max(dragStateRef.current.initialY + deltaY, margin),
          Math.max(margin, window.innerHeight - height - margin)
        ),
      });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (!dragStateRef.current || dragStateRef.current.pointerId !== upEvent.pointerId) {
        return;
      }

      dragStateRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [isMusicPage, miniPosition]);

  if (!isMusicPage && !currentMedia && !isLoading) {
    return null;
  }

  if (isAuthRoute) {
    return null;
  }

  const containerClasses = isMusicPage
    ? "fixed top-20 md:top-0 left-0 md:left-72 right-0 bottom-[80px] md:bottom-0 z-10 overflow-y-auto bg-transparent"
    : "fixed bottom-[84px] md:bottom-6 right-4 md:right-6 z-50";

  return (
    <div
      className={containerClasses}
      style={
        isMusicPage || !miniPosition
          ? undefined
          : {
              left: miniPosition.x,
              top: miniPosition.y,
              right: 'auto',
              bottom: 'auto',
            }
      }
    >
      <div className={isMusicPage ? "mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8" : "w-full"}>
        {isMusicPage && (
          <>
            <div className="glass-panel mb-6 rounded-3xl p-5 md:p-7">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Shared listening room</p>
              <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground md:text-4xl">Media</h1>
              <p className="mt-2 text-sm text-text-secondary md:text-base">Share YouTube videos and playlists in sync.</p>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Room mode</p>
                  <p className="mt-1 text-sm font-medium text-foreground">Synchronized playback</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="mt-1 text-sm font-medium text-foreground">YouTube video or playlist</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-1 text-sm font-medium text-foreground">Live and collaborative</p>
                </div>
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
      {/* Current Media */}
      {!isMusicPage && currentMedia ? (
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
            title={isMiniPlaying ? 'Stop playback' : 'Play playback'}
            aria-label={isMiniPlaying ? 'Stop playback' : 'Play playback'}
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
      ) : isLoading && isMusicPage ? (
        <div className="glass-panel rounded-3xl p-12 text-center">
          <p className="text-text-secondary">Loading media...</p>
        </div>
      ) : currentMedia ? (
        <div className={`glass-panel border border-border/70 ${isMusicPage ? 'overflow-hidden rounded-t-3xl' : 'rounded-2xl'}`}>
          {/* Media Info */}
          <div className={`p-4 flex items-center gap-3 ${isMusicPage ? 'md:p-6 md:gap-4 md:items-start border-b border-border' : ''}`}>
            {isMusicPage && (
              <div className="hidden md:flex w-20 h-20 rounded-lg bg-linear-to-br from-primary to-primary/70 items-center justify-center shrink-0">
                <Film className="w-10 h-10 text-white" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className={`font-serif font-semibold text-foreground leading-tight wrap-break-word ${isMusicPage ? 'text-2xl' : 'text-lg truncate'}`}>
                {currentMedia.title}
              </p>
              {isMusicPage && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="inline-block px-2 py-1 bg-primary/10 text-primary text-xs font-medium rounded">
                    Video
                  </span>
                  <p className="text-sm text-text-secondary capitalize font-medium">
                    YouTube
                  </p>
                </div>
              )}
              {currentMedia.added_by && (
                <p className={`text-text-tertiary ${isMusicPage ? 'text-xs mt-2' : 'text-[10px] mt-0.5 truncate'}`}>
                  Added by <span className="text-text-secondary font-medium">{currentMedia.added_by.name}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      ) : isMusicPage ? (
        <div className="glass-panel rounded-3xl p-12 text-center">
          <p className="text-text-secondary mb-2">No media playing yet</p>
          <p className="text-sm text-text-tertiary">
            Click "Share YouTube" to add content
          </p>
        </div>
      ) : null}

      {/* Persistent Player Mount (single instance across routes) */}
      {currentMedia && parsedYouTube && (
        <div
          className={isMusicPage ? 'glass-panel border border-t-0 border-border/70 overflow-hidden rounded-b-3xl' : 'absolute top-0 h-px w-px overflow-hidden pointer-events-none'}
          style={isMusicPage ? undefined : { left: -10000 }}
        >
          <YouTubeSyncPlayer
            mediaId={currentMedia.id}
            parsedUrl={parsedYouTube}
            syncEvent={externalSyncEvent}
            onPlaybackChange={handlePlaybackChange}
            isMusicPage={isMusicPage}
            className={isMusicPage ? 'w-full h-96' : 'h-px w-px'}
          />
        </div>
      )}

      {currentMedia && !parsedYouTube && isMusicPage && (
        <div className="glass-panel border border-t-0 border-border/70 rounded-b-3xl p-6">
          <p className="text-sm text-text-secondary text-center">
            Invalid YouTube URL.
          </p>
        </div>
      )}

      {/* Add Media Modal */}
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
function YouTubeSyncPlayer({
  mediaId,
  parsedUrl,
  syncEvent,
  onPlaybackChange,
  isMusicPage,
  className,
}: {
  mediaId: string;
  parsedUrl: { videoId: string | null; playlistId: string | null };
  syncEvent: PlaybackSyncPayload | null;
  onPlaybackChange: (action: PlaybackAction, currentTime: number, mediaId: string) => Promise<void>;
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
    let isCancelled = false;

    setPlayerError(null);

    loadYouTubeApi()
      .then((yt) => {
        if (isCancelled || !containerRef.current) {
          return;
        }

        ytRef.current = yt;

        safeDestroyPlayer(playerRef.current);
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
            ...(!parsedUrl.videoId && parsedUrl.playlistId
              ? { listType: 'playlist' }
              : {}),
          },
          events: {
            onStateChange: async (event) => {
              if (applyingRemoteSyncRef.current || !playerRef.current || !ytRef.current) {
                return;
              }

              const currentTime = playerRef.current.getCurrentTime();
              if (event.data === ytRef.current.PlayerState.PLAYING) {
                isPlayingRef.current = true;
                hiddenAutoPausedRef.current = false;
                await onPlaybackChange('play', currentTime, mediaId);
              }

              if (event.data === ytRef.current.PlayerState.PAUSED) {
                const hiddenPause = document.hidden && isPlayingRef.current;

                // Browser/window focus changes can pause playback; do not treat those as user intent.
                if (hiddenPause) {
                  hiddenAutoPausedRef.current = true;
                  // Aggressively attempt to wake the player back up to keep OS audio playing in background
                  playerRef.current?.playVideo();
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
        const message = error instanceof Error ? error.message : 'Unable to load YouTube player';
        setPlayerError(message);
      });

    return () => {
      isCancelled = true;
      isPlayingRef.current = false;
      hiddenAutoPausedRef.current = false;
      safeDestroyPlayer(playerRef.current);
      playerRef.current = null;
    };
  }, [parsedUrl.videoId, parsedUrl.playlistId, mediaId, onPlaybackChange]);

  useEffect(() => {
    const resumeIfHiddenPause = () => {
      // Re-trigger play immediately when backgrounding, sometimes required by iOS Safari to persist MediaSession
      if (document.hidden && isPlayingRef.current && playerRef.current) {
        playerRef.current.playVideo();
      } else if (!document.hidden && hiddenAutoPausedRef.current && playerRef.current) {
        hiddenAutoPausedRef.current = false;
        playerRef.current.playVideo();
      }
    };

    document.addEventListener('visibilitychange', resumeIfHiddenPause);
    window.addEventListener('focus', resumeIfHiddenPause);

    return () => {
      document.removeEventListener('visibilitychange', resumeIfHiddenPause);
      window.removeEventListener('focus', resumeIfHiddenPause);
    };
  }, []);

  useEffect(() => {
    if (!syncEvent || syncEvent.mediaId !== mediaId || !playerRef.current) {
      return;
    }

    if (typeof playerRef.current.seekTo !== 'function') {
      return;
    }

    const safeTime = Number.isFinite(syncEvent.currentTime)
      ? Math.max(syncEvent.currentTime, 0)
      : 0;

    applyingRemoteSyncRef.current = true;
    playerRef.current.seekTo(safeTime, true);

    if (syncEvent.action === 'play') {
      isPlayingRef.current = true;
      hiddenAutoPausedRef.current = false;
      playerRef.current.playVideo();
    } else {
      isPlayingRef.current = false;
      hiddenAutoPausedRef.current = false;
      playerRef.current.pauseVideo();
    }

    const timeout = window.setTimeout(() => {
      applyingRemoteSyncRef.current = false;
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [syncEvent, mediaId]);

  if (playerError) {
    return (
      <div className={`w-full flex items-center justify-center p-6 ${isMusicPage ? 'h-96' : 'h-48'}`}>
        <p className="text-sm text-text-secondary text-center">{playerError}</p>
      </div>
    );
  }

  return <div ref={containerRef} className={className ?? `w-full ${isMusicPage ? 'h-96' : 'h-48'}`} />;
}

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

  const handleSubmit = async () => {
    setError('');

    if (!url) {
      setError('Please enter a media URL');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/media/now-playing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
        }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? 'Failed to add media');
      }
    } catch (err) {
      setError('An error occurred');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="glass-panel-strong w-full max-w-md overflow-hidden rounded-3xl border border-border/70">
        {/* Header */}
        <div className="p-6 border-b border-border/70 bg-background/60">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Share Media</h2>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Link
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a YouTube video or playlist URL..."
              className="w-full px-4 py-2 bg-background/70 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-text-tertiary"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {error && (
            <div className="p-3 bg-error/10 text-error text-sm rounded-lg font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1"
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!url || isLoading}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Adding...
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
