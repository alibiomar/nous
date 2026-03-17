'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { TuniflixHlsPlayer } from '@/components/tuniflix-hls-player';
import { Layers, PlayCircle, Tv } from 'lucide-react';

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

export default function CinemaSeriesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [episodeSource, setEpisodeSource] = useState<EpisodeSource | null>(null);
  const [openSeason, setOpenSeason] = useState<string>('season-0');
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) {
      setError('Missing series slug');
      setIsLoadingSeries(false);
      return;
    }

    const loadSeries = async () => {
      setError('');
      setIsLoadingSeries(true);

      try {
        const response = await fetch(
          `/api/tuniflix/series/${encodeURIComponent(slug)}`,
          { credentials: 'omit' }
        );

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setSeasons([]);
          setError('Series endpoint returned a non-JSON response');
          return;
        }

        const data = (await response.json()) as Season[] | { error?: string };
        if (!response.ok) {
          setSeasons([]);
          setError((data as { error?: string }).error ?? 'Failed to load series');
          return;
        }

        const loadedSeasons = Array.isArray(data) ? data : [];
        setSeasons(loadedSeasons);

        const firstEpisode = loadedSeasons
          .flatMap((season) => season.episodes)
          .find((episode) => Boolean(episode.slug));

        if (firstEpisode) {
          setSelectedEpisode(firstEpisode);

          const seasonIndex = loadedSeasons.findIndex((season) =>
            season.episodes.some((episode) => episode.slug === firstEpisode.slug)
          );

          if (seasonIndex >= 0) {
            setOpenSeason(`season-${seasonIndex}`);
          }
        }
      } catch (seriesError) {
        console.error(seriesError);
        setSeasons([]);
        setError('Failed to load series');
      } finally {
        setIsLoadingSeries(false);
      }
    };

    loadSeries();
  }, [slug]);

  useEffect(() => {
    if (!selectedEpisode?.slug) {
      setEpisodeSource(null);
      return;
    }

    const loadEpisodeSource = async () => {
      setIsLoadingEpisode(true);
      setError('');

      try {
        const response = await fetch(
          `/api/tuniflix/episode/${encodeURIComponent(selectedEpisode.slug as string)}`,
          { credentials: 'omit' }
        );

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setEpisodeSource(null);
          setError('Episode endpoint returned a non-JSON response');
          return;
        }

        const data = (await response.json()) as EpisodeSource | { error?: string };
        if (!response.ok) {
          setEpisodeSource(null);
          setError((data as { error?: string }).error ?? 'Failed to load episode');
          return;
        }

        setEpisodeSource(data as EpisodeSource);
      } catch (episodeError) {
        console.error(episodeError);
        setEpisodeSource(null);
        setError('Failed to load episode source');
      } finally {
        setIsLoadingEpisode(false);
      }
    };

    loadEpisodeSource();
  }, [selectedEpisode?.slug]);

  const hasEpisodes = useMemo(
    () => seasons.some((season) => season.episodes.length > 0),
    [seasons]
  );

  const flattenedEpisodes = useMemo(
    () => seasons.flatMap((season) => season.episodes).filter((episode) => Boolean(episode.slug)),
    [seasons]
  );

  const selectedEpisodeIndex = useMemo(
    () => flattenedEpisodes.findIndex((episode) => episode.slug === selectedEpisode?.slug),
    [flattenedEpisodes, selectedEpisode?.slug]
  );

  const nextEpisode = useMemo(() => {
    if (selectedEpisodeIndex < 0) {
      return null;
    }

    return flattenedEpisodes[selectedEpisodeIndex + 1] ?? null;
  }, [flattenedEpisodes, selectedEpisodeIndex]);

  const findSeasonKeyForEpisode = (episodeSlug: string | null | undefined) => {
    if (!episodeSlug) {
      return null;
    }

    const seasonIndex = seasons.findIndex((season) =>
      season.episodes.some((episode) => episode.slug === episodeSlug)
    );

    if (seasonIndex < 0) {
      return null;
    }

    return `season-${seasonIndex}`;
  };

  const getSeasonProgress = (season: Season) => {
    const total = season.episodes.length;
    const selectedIndex = season.episodes.findIndex(
      (episode) => episode.slug === selectedEpisode?.slug
    );
    const current = selectedIndex >= 0 ? selectedIndex + 1 : 0;
    const ratio = total > 0 ? current / total : 0;

    return { total, current, ratio };
  };

  if (isLoadingSeries) {
    return (
      <div className="glass-panel rounded-3xl border border-border/70 p-8">
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
            <h2 className="mt-2 text-xl font-serif font-semibold text-foreground md:text-2xl">
              {selectedEpisode.title}
            </h2>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Select an episode to start.</p>
        )}

        <div className="mt-4">
          {isLoadingEpisode ? (
            <div className="rounded-2xl border border-border/70 bg-background/55 p-4">
              <p className="text-sm text-muted-foreground">Loading episode source...</p>
            </div>
          ) : episodeSource?.stream ? (
            <TuniflixHlsPlayer
              stream={episodeSource.stream}
              embedReferer={episodeSource.embed ?? undefined}
              syncId={`cinema:series:${slug}:${selectedEpisode?.slug ?? 'unknown'}`}
              className="h-[56vw] max-h-[70vh] min-h-75 w-full overflow-hidden rounded-2xl ring-1 ring-border/60"
            />
          ) : episodeSource?.embed ? (
            <iframe
              src={episodeSource.embed}
              className="h-[56vw] max-h-[70vh] min-h-75 w-full rounded-2xl ring-1 ring-border/60"
              allowFullScreen
              title={selectedEpisode?.title || 'Episode player'}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No playable source for this episode.</p>
          )}
        </div>

      </section>

      <aside className="order-2 glass-panel rounded-3xl border border-border/70 p-4 md:p-6 xl:order-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Tv className="h-3.5 w-3.5" />
          Series
        </p>
        <h1 className="mt-2 text-2xl font-serif font-semibold text-foreground md:text-3xl break-all">
          {slug}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick an episode to watch together.
        </p>

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
              onValueChange={(value) => setOpenSeason(value || 'season-0')}
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
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
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
