'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TuniflixHlsPlayer } from '@/components/tuniflix-hls-player';

type MoviePayload = {
  title: string;
  embed: string | null;
  stream: string | null;
};

export default function CinemaMoviePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [movie, setMovie] = useState<MoviePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) {
      setError('Missing movie slug');
      setIsLoading(false);
      return;
    }

    const loadMovie = async () => {
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch(
          `/api/tuniflix/movie/${encodeURIComponent(slug)}`,
          { credentials: 'omit' }
        );
        const contentType = response.headers.get('content-type') ?? '';

        if (!contentType.includes('application/json')) {
          setMovie(null);
          setError('Movie endpoint returned a non-JSON response');
          return;
        }

        const data = (await response.json()) as MoviePayload | { error?: string };

        if (!response.ok) {
          setMovie(null);
          setError((data as { error?: string }).error ?? 'Failed to load movie');
          return;
        }

        setMovie(data as MoviePayload);
      } catch (loadError) {
        console.error(loadError);
        setMovie(null);
        setError('Failed to load movie');
      } finally {
        setIsLoading(false);
      }
    };

    loadMovie();
  }, [slug]);

  if (isLoading) {
    return (
      <div className="glass-panel rounded-3xl p-8">
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

  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-3xl p-5 md:p-7">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Now playing</p>
        <h1 className="mt-2 text-3xl font-serif font-semibold text-foreground md:text-4xl">
          {movie.title || slug}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Playback sync is enabled for direct HLS streams.
        </p>
      </section>

      <section className="glass-panel rounded-3xl border border-border/70 p-4 md:p-6">
        {movie.stream ? (
          <TuniflixHlsPlayer
            stream={movie.stream}
            embedReferer={movie.embed ?? undefined}
            syncId={`cinema:movie:${slug}`}
            className="h-[56vw] max-h-[70vh] min-h-75 w-full"
          />
        ) : movie.embed ? (
          <iframe
            src={movie.embed}
            className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-xl"
            allowFullScreen
            title={movie.title || 'Movie player'}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No playable source found for this movie.</p>
        )}
      </section>
    </div>
  );
}
