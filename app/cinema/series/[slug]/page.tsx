'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/client';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { TuniflixHlsPlayer } from '@/components/tuniflix-hls-player';
import { useStreamCapture } from '@/hooks/use-stream-capture';
import { Layers, PlayCircle, Tv } from 'lucide-react';
import { useCinemaSync } from '@/hooks/use-cinema-sync';

type Episode = {
  title: string;
  slug: string | null;
  link: string | null;
};

type Season = {
  season: string;
  episodes: Episode[];
};

type EpisodeSource = {
  embed: string | null;
  stream: string | null;
};

type RoomStatePayload = {
  series?: string;
  episode?: string;
  slug?: string;
};

export default function CinemaSeriesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();
  const search = useSearchParams();
  const roomParam = search?.get('room') ?? 'cinema:shared';
  const supabase = createClient();
   
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [episodeSource, setEpisodeSource] = useState<EpisodeSource | null>(null);
  const [openSeason, setOpenSeason] = useState<string>('season-0');
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);
  const [error, setError] = useState('');
  const [isClearing, setIsClearing] = useState(false);
const syncId = slug && selectedEpisode?.slug
  ? `cinema:series:${slug}:${selectedEpisode.slug}`
  : null;
const { externalSyncEvent, isPlaying, handlePlaybackChange } = useCinemaSync(syncId);
 
  // Client-side stream capture from the episode's embed URL
  const { streamUrl, loading: capturing, error: captureError } = useStreamCapture(
    episodeSource?.embed ?? null
  );

  // --- Load series ---
  useEffect(() => {
    if (!slug) {
      setError('Missing series slug');
      setIsLoadingSeries(false);
      return;
    }

    const load = async () => {
      setError('');
      setIsLoadingSeries(true);
      try {
        const res = await fetch(`/api/tuniflix/series/${encodeURIComponent(slug)}`, {
          credentials: 'omit',
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setError('Series endpoint returned a non-JSON response');
          return;
        }
        const data = (await res.json()) as Season[] | { error?: string };
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Failed to load series');
          return;
        }
        const loaded = Array.isArray(data) ? data : [];
        setSeasons(loaded);


        const first = loaded.flatMap((s) => s.episodes).find((e) => Boolean(e.slug));
        if (first) {
          setSelectedEpisode(first);
          const idx = loaded.findIndex((s) => s.episodes.some((e) => e.slug === first.slug));
          if (idx >= 0) setOpenSeason(`season-${idx}`);
        }
      } catch {
        setError('Failed to load series');
      } finally {
        setIsLoadingSeries(false);
      }
    };

    void load();
  }, [slug]);

  // --- Load episode source ---
  useEffect(() => {
    if (!selectedEpisode?.slug) {
      setEpisodeSource(null);
      return;
    }

    const load = async () => {
      setIsLoadingEpisode(true);
      setError('');
      try {
        const res = await fetch(
          `/api/tuniflix/episode/${encodeURIComponent(selectedEpisode.slug as string)}`,
          { credentials: 'omit' }
        );
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setError('Episode endpoint returned a non-JSON response');
          return;
        }
        const data = (await res.json()) as EpisodeSource | { error?: string };
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Failed to load episode');
          return;
        }
        setEpisodeSource(data as EpisodeSource);
      } catch {
        setError('Failed to load episode source');
      } finally {
        setIsLoadingEpisode(false);
      }
    };

    void load();
  }, [selectedEpisode?.slug]);

  // --- Broadcast selection ---
  useEffect(() => {
    if (!selectedEpisode?.slug || !episodeSource) return;
    void fetch('/api/cinema-room-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: roomParam,
        room_type: 'series',
        payload: {
          series: slug,
          episode: selectedEpisode.slug,
          title: selectedEpisode.title,
          embed: episodeSource.embed ?? null,
        },
      }),
    }).catch(() => undefined);
  }, [selectedEpisode?.slug, episodeSource, slug, roomParam]);

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

        if (payload.series && payload.series !== slug) {
          router.push(`/cinema/series/${payload.series}`);
          return;
        }
        if (payload.episode && payload.episode !== selectedEpisode?.slug) {
          router.push(`/cinema/series/${slug}?episode=${payload.episode}`);
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
  }, [roomParam, slug, router, selectedEpisode?.slug, supabase]);

  const flattenedEpisodes = useMemo(
    () => seasons.flatMap((s) => s.episodes).filter((e) => Boolean(e.slug)),
    [seasons]
  );

  const hasEpisodes = flattenedEpisodes.length > 0;

  // Handle ?episode= param
  useEffect(() => {
    const episodeParam = search?.get('episode');
    if (!episodeParam || flattenedEpisodes.length === 0) return;
    const match = flattenedEpisodes.find((e) => e.slug === episodeParam);
    if (!match) return;
    setSelectedEpisode(match);
    const idx = seasons.findIndex((s) => s.episodes.some((e) => e.slug === episodeParam));
    if (idx >= 0) setOpenSeason(`season-${idx}`);
  }, [search, flattenedEpisodes, seasons]);

  const selectedEpisodeIndex = useMemo(
    () => flattenedEpisodes.findIndex((e) => e.slug === selectedEpisode?.slug),
    [flattenedEpisodes, selectedEpisode?.slug]
  );

  const nextEpisode = flattenedEpisodes[selectedEpisodeIndex + 1] ?? null;

  const getSeasonProgress = (season: Season) => {
    const total = season.episodes.length;
    const idx = season.episodes.findIndex((e) => e.slug === selectedEpisode?.slug);
    const current = idx >= 0 ? idx + 1 : 0;
    return { total, current, ratio: total > 0 ? current / total : 0 };
  };

  const renderPlayer = () => {
    if (isLoadingEpisode) {
      return (
        <div className="rounded-2xl border border-border/70 bg-background/55 p-4 flex">
                            <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />

          <p className="text-sm text-muted-foreground">Loading episode source...</p>
        </div>
      );
    }

    if (streamUrl) {
      return (
        <TuniflixHlsPlayer
          stream={streamUrl}
          embedReferer={episodeSource?.embed ?? undefined}
          syncId={`cinema:series:${slug}:${selectedEpisode?.slug ?? 'unknown'}`}
          externalSyncEvent={externalSyncEvent}          // ← NEW
  onPlaybackChange={handlePlaybackChange}   
          className="h-[56vw] max-h-[70vh] min-h-75 w-full overflow-hidden rounded-2xl ring-1 ring-border/60"
        />
      );
    }

    if (capturing) {
      return (
        <div className="flex h-[56vw] max-h-[70vh] min-h-75 w-full items-center justify-center rounded-2xl bg-black/40 ring-1 ring-border/60">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
            <p className="text-sm text-white/60">Connecting to stream...</p>
          </div>
        </div>
      );
    }

    if (episodeSource?.embed) {
      return (
        <iframe
          src={episodeSource.embed}
          className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-2xl ring-1 ring-border/60"
          allowFullScreen
          title={selectedEpisode?.title || 'Episode player'}
        />
      );
    }

    return (
      <p className="text-sm text-muted-foreground">No playable source for this episode.</p>
    );
  };

  if (isLoadingSeries) {
    return (
      <div className="glass-panel rounded-3xl border border-border/70 p-8 flex">
                        <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />

        <p className="text-muted-foreground">Loading series...</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="order-1 glass-panel rounded-3xl border border-border/70 p-4 md:p-6 xl:order-1">
        {selectedEpisode ? (
          <>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <PlayCircle className="h-3.5 w-3.5" />
              Now playing
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
            {nextEpisode && (
              <button
                type="button"
                onClick={() => setSelectedEpisode(nextEpisode)}
                className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Up next: {nextEpisode.title}
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select an episode to start.</p>
        )}

        <div className="mt-4">{renderPlayer()}</div>
      </section>

      <aside className="order-2 glass-panel rounded-3xl border border-border/70 p-4 md:p-6 xl:order-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Tv className="h-3.5 w-3.5" />
          Series
        </p>
        <h1 className="mt-2 text-2xl font-serif font-semibold text-foreground md:text-3xl break-all">
          {slug}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick an episode to watch together.</p>

        {error ? <p className="mt-3 text-sm font-medium text-error">{error}</p> : null}

        {!hasEpisodes ? (
          <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 p-4">
            <p className="text-sm text-muted-foreground">No episodes found.</p>
          </div>
        ) : (
          <div className="mt-4 max-h-[70vh] overflow-y-auto pr-1">
            <Accordion
              type="single"
              collapsible
              value={openSeason}
              onValueChange={(v) => setOpenSeason(v || 'season-0')}
              className="space-y-3"
            >
              {seasons.map((season, seasonIndex) => {
                const seasonKey = `season-${seasonIndex}`;
                const progress = getSeasonProgress(season);

                return (
                  <AccordionItem
                    key={`${season.season}-${season.episodes.length}-${seasonIndex}`}
                    value={seasonKey}
                    className="rounded-2xl border border-border/60 bg-background/45 px-3"
                  >
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="flex items-center gap-1.5 text-md font-medium uppercase tracking-[0.12em] text-muted-foreground">
                            <Layers className="h-3.5 w-3.5" />
                            {season.season}
                          </p>
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-lg font-medium text-primary">
                            {progress.current}/{progress.total}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                          />
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">
                      <div className="space-y-2">
                        {season.episodes.map((episode, index) => {
                          const isActive = selectedEpisode?.slug === episode.slug;
                          return (
                            <Button
                              key={`${episode.slug ?? episode.title}-${index}`}
                              type="button"
                              variant={isActive ? 'default' : 'outline'}
                              className="w-full justify-start text-left transition-colors"
                              disabled={!episode.slug || isLoadingEpisode}
                              onClick={() => {
                                setSelectedEpisode(episode);
                                setOpenSeason(seasonKey);
                              }}
                            >
                              {episode.title || `Episode ${index + 1}`}
                            </Button>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        )}
      </aside>
    </div>
  );
}