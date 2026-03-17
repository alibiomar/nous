'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { TuniflixHlsPlayer } from '@/components/tuniflix-hls-player';
import { useStreamCapture } from '@/hooks/use-stream-capture';
import { createClient } from '@/lib/client';
import { useCinemaSync } from '@/hooks/use-cinema-sync';
import { Button } from '@/components/ui/button';

type MoviePayload = {
  title: string;
  embed: string | null;
  stream: string | null;
};

type RoomStatePayload = {
  slug?: string;
  series?: string;
  episode?: string;
};

export default function CinemaMoviePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();
  const search = useSearchParams();
  const roomParam = search?.get('room') ?? 'cinema:shared';
  const supabase = createClient();
  const syncId = slug ? `cinema:movie:${slug}` : null;

const { externalSyncEvent, isPlaying, handlePlaybackChange } = useCinemaSync(syncId);
    
  const [movie, setMovie] = useState<MoviePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  // Client-side stream capture — token is bound to user's IP, not server's
  const { streamUrl, loading: capturing, error: captureError } = useStreamCapture(
    movie?.embed ?? null
  );

  // --- Load movie ---
  useEffect(() => {
    if (!slug) {
      setError('Missing movie slug');
      setIsLoading(false);
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/tuniflix/movie/${encodeURIComponent(slug)}`, {
          credentials: 'omit',
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setError('Movie endpoint returned a non-JSON response');
          return;
        }
        const data = (await res.json()) as MoviePayload | { error?: string };
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Failed to load movie');
          return;
        }
        setMovie(data as MoviePayload);
      } catch {
        setError('Failed to load movie');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [slug]);

  // --- Broadcast selection ---
  useEffect(() => {
    if (!movie || !slug) return;
    void fetch('/api/cinema-room-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: roomParam,
        room_type: 'movie',
        payload: { slug, title: movie.title ?? null, embed: movie.embed ?? null },
      }),
    }).catch(() => undefined);
  }, [movie, slug, roomParam]);

  // --- Subscribe to room state ---
  useEffect(() => {
    if (!roomParam) return;

    const fetchState = async () => {
      try {
        const res = await fetch(`/api/cinema-room-state?room=${encodeURIComponent(roomParam)}`);
        if (!res.ok) return;
        const data = await res.json() as { payload?: RoomStatePayload } | null;
        const payload = data?.payload;
        if (!payload) return;

        if (payload.slug && payload.slug !== slug) {
          router.push(`/cinema/movie/${payload.slug}`);
          return;
        }
        if (payload.series) {
          const dest = payload.episode
            ? `/cinema/series/${payload.series}?episode=${payload.episode}`
            : `/cinema/series/${payload.series}`;
          router.push(dest);
        }
      } catch {
        // ignore
      }
    };

    void fetchState();

    const channel = supabase
      .channel('cinema-room-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cinema_room_state' }, () => {
        void fetchState();
      })
      .subscribe();

    return () => void supabase.removeChannel(channel);
  }, [roomParam, slug, router, supabase]);

  if (isLoading) {
    return (
      <div className="glass-panel rounded-3xl p-8">
                        <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />

        <p className="text-muted-foreground">Loading movie...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-3xl p-8">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="glass-panel rounded-3xl p-8">
        <p className="text-muted-foreground">No movie data found.</p>
      </div>
    );
  }

  const renderPlayer = () => {
    // Stream successfully captured client-side
    if (streamUrl) {
      return (
        <TuniflixHlsPlayer
          stream={streamUrl}
          embedReferer={movie.embed ?? undefined}
          syncId={`cinema:movie:${slug}`}
            externalSyncEvent={externalSyncEvent}          // ← NEW
  onPlaybackChange={handlePlaybackChange}
          className="h-[56vw] max-h-[70vh] min-h-75 w-full"
        />
      );
    }

    // Still trying to capture stream
    if (capturing) {
      return (
        <div className="flex h-[56vw] max-h-[70vh] min-h-75 w-full items-center justify-center rounded-xl bg-black/40">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
                            <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />

            <p className="text-sm text-white/60">Connecting to stream...</p>
          </div>
        </div>
      );
    }

    // Capture failed — fall back to iframe embed
    if (captureError && movie.embed) {
      return (
        <iframe
          src={movie.embed}
          className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-xl"
          allowFullScreen
          title={movie.title || 'Movie player'}
        />
      );
    }

    if (!movie.embed) {
      return <p className="text-sm text-muted-foreground">No playable source found.</p>;
    }

    // embed exists, capture still in progress — show iframe as immediate fallback
    return (
      <iframe
        src={movie.embed}
        className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-xl"
        allowFullScreen
        title={movie.title || 'Movie player'}
      />
    );
  };

  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-3xl p-5 md:p-7">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Now playing</p>

        <p className="mt-2 text-sm text-muted-foreground">
          {streamUrl ? 'Playback sync enabled.' : capturing ? 'Connecting...' : 'Sync unavailable — using embed player.'}
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3 text-sm"
            onClick={async () => {
              if (isClearing) return;
              setIsClearing(true);
              try {
                await fetch(`/api/cinema-room-state?room=${encodeURIComponent(roomParam)}`, {
                  method: 'DELETE',
                  credentials: 'include',
                });
                router.push('/cinema');
              } catch (e) {
                // ignore
              } finally {
                setIsClearing(false);
              }
            }}
          >
            {isClearing ? 'Clearing…' : 'Watch something new'}
          </Button>
        </div>
      </section>

      <section className="glass-panel rounded-3xl border border-border/70 p-4 md:p-6">
        {renderPlayer()}
      </section>
    </div>
  );
}