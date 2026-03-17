'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clapperboard, Sparkles, Tv, Search, ArrowUpRight, Film } from 'lucide-react';

type SearchResult = {
  title: string;
  slug: string;
  type: 'movie' | 'series';
  image: string | null;
  link: string;
};

export default function CinemaPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();

    if (!trimmed) {
      setResults([]);
      setError('Please enter a movie or series name');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(
        `/api/tuniflix/search?q=${encodeURIComponent(trimmed)}`,
        { credentials: 'omit' }
      );
      const contentType = response.headers.get('content-type') ?? '';

      if (!contentType.includes('application/json')) {
        setResults([]);
        setError('Search endpoint returned a non-JSON response');
        return;
      }

      const data = (await response.json()) as SearchResult[] | { error?: string };

      if (!response.ok) {
        setResults([]);
        setError((data as { error?: string }).error ?? 'Search failed');
        return;
      }

      setResults(Array.isArray(data) ? data : []);
    } catch (searchError) {
      console.error(searchError);
      setResults([]);
      setError('Failed to search right now');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = (result: SearchResult) => {
    if (result.type === 'movie') {
      router.push(`/cinema/movie/${result.slug}`);
      return;
    }

    router.push(`/cinema/series/${result.slug}`);
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="glass-panel relative overflow-hidden rounded-3xl border border-border/70 p-5 md:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-secondary/60 blur-2xl" />

                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Shared cinema room</p>

        <h1 className="mt-2 text-3xl font-serif font-semibold text-foreground md:text-5xl">
          Cinema
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
          Find a movie or series and watch together with synchronized playback.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-foreground">
            <Clapperboard className="h-3.5 w-3.5 text-primary" />
            Movies
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-foreground">
            <Tv className="h-3.5 w-3.5 text-primary" />
            Series
          </span>
          <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-foreground">
            Live sync
          </span>
        </div>

        <form onSubmit={handleSearch} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a movie or series name..."
              className="h-11 pl-9"
            />
          </div>
          <Button type="submit" className="h-11 px-5 sm:min-w-32" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search'}
          </Button>
        </form>

        {error ? (
          <p className="mt-3 rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error">{error}</p>
        ) : null}
      </section>

      {results.length === 0 && !isLoading ? (
        <section className="glass-panel rounded-3xl border border-border/70 p-8 text-center">
          <p className="text-sm text-muted-foreground">Search for something to begin your cinema session.</p>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {results.map((result) => (
          <article
            key={`${result.type}-${result.slug}`}
            onClick={() => handleOpen(result)}
            className="cursor-pointer glass-panel group overflow-hidden rounded-3xl border border-border/70 p-0 transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg"
          > 
            <div className="relative">
              {result.image ? (
                <img
                  src={result.image}
                  alt={result.title}
                  className="aspect-4/5 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-4/5 w-full items-center justify-center bg-linear-to-br from-secondary to-secondary/60">
                  <Film className="h-10 w-10 text-primary/70" />
                </div>
              )}

              <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/55 via-black/15 to-transparent" />
              <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
                <span className="rounded-full border border-white/30 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                  {result.type}
                </span>
              </div>

              <div className="absolute bottom-3 left-3 right-3">
                <h2 className="line-clamp-2 text-xl font-semibold leading-tight text-white drop-shadow-sm">
                  {result.title}
                </h2>
              </div>
            </div>


          </article>
        ))}
      </section>
    </div>
  );
}
