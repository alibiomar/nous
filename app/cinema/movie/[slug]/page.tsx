'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { TuniflixEmbedPlayer } from '@/components/tuniflix-embed-player';
import { createClient } from '@/lib/client';
import { useCinemaSync } from '@/hooks/use-cinema-sync';
import { Button } from '@/components/ui/button';
import { useUser } from '@/contexts/user';
import { CinemaPlayerSkeleton } from '@/components/screenLoading';
type MoviePayload = {
  title: string;
  embed: string | null;
  stream: string | null;
};

type RoomStatePayload = {
  slug?: string;
  series?: string;
  episode?: string;
  version?: number;
};

export default function CinemaMoviePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();
  const search = useSearchParams();
  const roomParam = search?.get('room') ?? 'cinema-shared';
  const supabase = createClient();
    const { user } = useUser();
  const currentUserId = user?.id;
  const syncId = useMemo(() => slug ? `cinema:movie:${slug}` : null, [slug]);

  const { externalSyncEvent, handlePlaybackChange, senderId } = useCinemaSync(syncId);


  const [movie, setMovie] = useState<MoviePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearVotes, setClearVotes] = useState(0);
  const [votesRequired, setVotesRequired] = useState(2);
  const [isVoting, setIsVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // Version guard — same pattern as series page
  const remoteVersionRef = useRef<number>(0);



  // ── Load movie ────────────────────────────────────────────────────────────
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

  // ── Broadcast selection ───────────────────────────────────────────────────
  useEffect(() => {
    if (!movie || !slug) return;
    void fetch('/api/cinema-room-state', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: roomParam,
        room_type: 'movie',
        payload: { slug, title: movie.title ?? null, embed: movie.embed ?? null },
      }),
    }).catch(() => undefined);
  }, [movie, slug, roomParam]);

  // ── Subscribe to room state ───────────────────────────────────────────────
  useEffect(() => {
    if (!roomParam) return;

    const fetchState = async () => {
      try {
        const res = await fetch(`/api/cinema-room-state?room=${encodeURIComponent(roomParam)}`);
        if (!res.ok) return;
        const data = await res.json() as {
          payload?: RoomStatePayload;
          version?: number;
          clearVotes?: number;
          votesRequired?: number;
        } | null;

        if (data?.clearVotes !== undefined) setClearVotes(data.clearVotes);
        if (data?.votesRequired !== undefined) setVotesRequired(data.votesRequired);

        const remoteVersion = data?.version ?? 0;

        // Only apply remote navigation if it's a genuinely newer state
        if (remoteVersion <= remoteVersionRef.current) return;
        remoteVersionRef.current = remoteVersion;

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cinema_clear_votes' }, () => {
        void fetchState();
      })
      .subscribe();

    return () => void supabase.removeChannel(channel);
  }, [roomParam, slug, router, supabase]);

  // ── Vote to clear room ────────────────────────────────────────────────────
  const handleClearVote = async () => {
    if (isVoting || hasVoted) return;
    setIsVoting(true);
    try {
      const res = await fetch(
        `/api/cinema-room-state?room=${encodeURIComponent(roomParam)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = await res.json() as {
        cleared?: boolean;
        votes?: number;
        votesRequired?: number;
      };

      if (data.cleared) {
        router.push('/cinema');
      } else {
        setHasVoted(true);
        setClearVotes(data.votes ?? 1);
        if (data.votesRequired) setVotesRequired(data.votesRequired);
      }
    } catch {
      // ignore
    } finally {
      setIsVoting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
    <CinemaPlayerSkeleton />
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
    if (!movie.embed) {
      return <p className="text-sm text-muted-foreground">No playable source found.</p>;
    }

    return (
      <TuniflixEmbedPlayer
        src={movie.embed}
        title={movie.title || 'Movie player'}
        className="h-[56vw] max-h-[70vh] min-h-75 w-full overflow-hidden rounded-2xl ring-1 ring-border/60"
        externalSyncEvent={externalSyncEvent}
        onPlaybackChange={handlePlaybackChange}
        currentUserId={currentUserId}
        senderId={senderId}
      />
    );
  };

  
  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-3xl p-5 md:p-7">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Now playing</p>
        <h1 className="mt-2 text-2xl font-serif font-semibold text-foreground uppercase md:text-3xl">
          {movie.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Watching together.
        </p>
      </section>

      <section className="glass-panel rounded-3xl border border-border/70 p-4 md:p-6">
        {renderPlayer()}
        <div className="mt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-3 text-sm"
            disabled={isVoting || hasVoted}
            onClick={handleClearVote}
          >
            {isVoting
              ? 'Voting…'
              : hasVoted
              ? `Waiting for other (${clearVotes}/${votesRequired})`
              : clearVotes > 0
              ? `Watch something new (${clearVotes}/${votesRequired})`
              : 'Watch something new'}
          </Button>
        </div>
      </section>
    </div>
  );
}