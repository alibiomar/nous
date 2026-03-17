'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { TuniflixHlsPlayer } from '@/components/tuniflix-hls-player';
import { Film, PlayCircle } from 'lucide-react';

type MoviePayload = {
  title: string;
  embed: string ;
  stream: string | null;
};

export default function CinemaMoviePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [movie, setMovie] = useState<MoviePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);

  useEffect(() => {
    if (!slug) {
      setError('Missing movie slug');
      setIsLoading(false);
      return;
    }

    const loadMovie = async () => {
      setIsLoading(true);
      setError('');
      setUseEmbedFallback(false);

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
      <div className="glass-panel rounded-3xl border border-border/70 p-8">
        <p className="text-muted-foreground">Loading movie...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-3xl border border-border/70 p-8">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="glass-panel rounded-3xl border border-border/70 p-8">
        <p className="text-muted-foreground">No movie data found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="glass-panel relative overflow-hidden rounded-3xl border border-border/70 p-5 md:p-7">
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/20 blur-2xl" />
        <div className="mb-3">
          <Link
            href="/cinema"
            className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
          >
            Back to Cinema
          </Link>
        </div>
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Film className="h-3.5 w-3.5" />
          Now playing
        </p>
        <h1 className="mt-2 text-3xl font-serif font-semibold text-foreground md:text-4xl">
          {movie.title || slug}
        </h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <PlayCircle className="h-3.5 w-3.5" />
          Sync enabled for direct streams
        </div>
      </section>

      <section className="glass-panel rounded-3xl border border-border/70 p-4 md:p-6">
        {/* {movie.stream && !useEmbedFallback ? (
          <TuniflixHlsPlayer
            stream={movie.stream}
            syncId={`cinema:movie:${slug}`}
            onFatalError={() => setUseEmbedFallback(true)}
            className="h-[56vw] max-h-[70vh] min-h-75 w-full overflow-hidden rounded-2xl ring-1 ring-border/60"
          />
        ) : movie.embed ? ( */}
          <iframe
            src={movie.embed}
            className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-2xl ring-1 ring-border/60"
            allowFullScreen
            title={movie.title || 'Movie player'}
          />
        {/* ) : (
          <p className="text-sm text-muted-foreground">No playable source found for this movie.</p>
        )} */}
      </section>
    </div>
  );
}
