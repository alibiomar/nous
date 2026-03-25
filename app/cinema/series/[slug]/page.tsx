'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/client';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { TuniflixEmbedPlayer } from '@/components/tuniflix-embed-player';
import { ChevronRight, Layers, PlayCircle, Tv } from 'lucide-react';
import { useCinemaSync } from '@/hooks/use-cinema-sync';
import { useUser } from '@/contexts/user';
type Episode = {
  title: string;
  slug: string | null;
  link: string | null;
  number: number;
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
  version?: number;
};

type WatchedEpisode = {
  episode_slug: string;
  episode_title: string;
  episode_number: number;
  watched_at: string;
};

export default function CinemaSeriesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const router = useRouter();
  const search = useSearchParams();
  const roomParam = search?.get('room') ?? 'cinema:shared';
  const supabase = createClient();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [episodeSource, setEpisodeSource] = useState<EpisodeSource | null>(null);
  const [openSeason, setOpenSeason] = useState<string>('season-0');
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [isLoadingEpisode, setIsLoadingEpisode] = useState(false);
  const [error, setError] = useState('');
  const [clearVotes, setClearVotes] = useState(0);
  const [votesRequired, setVotesRequired] = useState(2);
  const [isVoting, setIsVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [watchedSlugs, setWatchedSlugs] = useState<Set<string>>(new Set());
    const { user } = useUser();
  const currentUserId = user?.id;
  // ── Version ref ────────────────────────────────────────────────────────────
  // Incremented every time THIS client picks an episode locally.
  // Remote DB updates are only applied when they carry a higher version,
  // preventing stale reads from overriding what the user just selected.
  const localVersionRef = useRef<number>(0);
  const remoteVersionRef = useRef<number>(0);

  const syncId = useMemo(
    () => slug && selectedEpisode?.slug
      ? `cinema:series:${slug}:${selectedEpisode.slug}`
      : null,
    [slug, selectedEpisode?.slug]
  );
const { externalSyncEvent, handlePlaybackChange, senderId } = useCinemaSync(syncId);



  // ── Select episode (local — increments version) ───────────────────────────
  const selectEpisode = (episode: Episode, seasonKey: string) => {
    localVersionRef.current += 1;
    setSelectedEpisode(episode);
    setOpenSeason(seasonKey);
  };

  // ── Load series + watch history ───────────────────────────────────────────
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
        const [seriesRes, historyRes] = await Promise.all([
          fetch(`/api/tuniflix/series/${encodeURIComponent(slug)}`, { credentials: 'omit' }),
          fetch(`/api/cinema-watch-history?series=${encodeURIComponent(slug)}`),
        ]);

        const contentType = seriesRes.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          setError('Series endpoint returned a non-JSON response');
          return;
        }

        const data = (await seriesRes.json()) as { title: string; seasons: Season[] } | { error?: string };
        if (!seriesRes.ok) {
          setError((data as { error?: string }).error ?? 'Failed to load series');
          return;
        }

        const { title: fetchedTitle, seasons: loadedSeasons } = data as { title: string; seasons: Season[] };
        const loaded = Array.isArray(loadedSeasons) ? loadedSeasons : [];
        setSeriesTitle(fetchedTitle || slug || '');
        setSeasons(loaded);

        // Build watched set — parse history once and reuse
        let watched = new Set<string>();
        let history: WatchedEpisode[] = [];
        if (historyRes.ok) {
          history = (await historyRes.json()) as WatchedEpisode[];
          watched = new Set(history.map((h) => h.episode_slug));
          setWatchedSlugs(watched);
        }

        const allEpisodes = loaded.flatMap((s) => s.episodes).filter((e) => Boolean(e.slug));

        // Priority: ?episode= param → last watched (by watched_at desc) → first episode
        const episodeParam = search?.get('episode');
        let toSelect: Episode | undefined;

        if (episodeParam) {
          toSelect = allEpisodes.find((e) => e.slug === episodeParam);
        }

        if (!toSelect && history.length > 0) {
          // history is already sorted desc by watched_at from the API
          // find the most recently watched episode that still exists in the loaded series
          for (const h of history) {
            const match = allEpisodes.find((e) => e.slug === h.episode_slug);
            if (match) { toSelect = match; break; }
          }
        }

        if (!toSelect) {
          toSelect = allEpisodes[0];
        }

        if (toSelect) {
          const idx = loaded.findIndex((s) =>
            s.episodes.some((e) => e.slug === toSelect!.slug)
          );
          // Use setSelectedEpisode directly here (not selectEpisode) so localVersionRef
          // stays at 0 — this lets the remote room state still take over on initial load
          // if the other user is watching a different episode.
          setSelectedEpisode(toSelect);
          if (idx >= 0) setOpenSeason(`season-${idx}`);
        }
      } catch {
        setError('Failed to load series');
      } finally {
        setIsLoadingSeries(false);
      }
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // ── Load episode source ───────────────────────────────────────────────────
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

  // ── Record watch history when episode source loads ────────────────────────
  useEffect(() => {
    if (!selectedEpisode?.slug || !episodeSource || !slug) return;

    setWatchedSlugs((prev) => {
      if (prev.has(selectedEpisode.slug!)) return prev;
      const next = new Set(prev);
      next.add(selectedEpisode.slug!);
      return next;
    });

    void fetch('/api/cinema-watch-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series_slug: slug,
        episode_slug: selectedEpisode.slug,
        episode_title: selectedEpisode.title,
        episode_number: selectedEpisode.number,
      }),
    }).catch(() => undefined);
  }, [selectedEpisode?.slug, episodeSource, slug]);

  // ── Broadcast selection to room ───────────────────────────────────────────
  useEffect(() => {
    if (!selectedEpisode?.slug || !episodeSource || !slug) return;

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

        // Update vote counts regardless
        if (data?.clearVotes !== undefined) setClearVotes(data.clearVotes);
        if (data?.votesRequired !== undefined) setVotesRequired(data.votesRequired);

        const payload = data?.payload;
        const remoteVersion = data?.version ?? 0;

        // ── Version guard ──────────────────────────────────────────────────
        // Only act on remote state if it's newer than what we've already applied.
        // This prevents a page refresh or quick episode switch from getting
        // overwritten by a stale DB read.
        if (remoteVersion <= remoteVersionRef.current) return;
        remoteVersionRef.current = remoteVersion;

        // If the local user already moved past this version, ignore remote.
        if (localVersionRef.current > 0) return;

        if (!payload) return;

        if (payload.series && payload.series !== slug) {
          router.push(`/cinema/series/${payload.series}`);
          return;
        }

        if (payload.episode && payload.episode !== selectedEpisode?.slug) {
          // Remote picked a different episode — navigate via URL so ?episode= param is set
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cinema_clear_votes' }, () => {
        void fetchState();
      })
      .subscribe();

    return () => void supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomParam, slug, router, selectedEpisode?.slug, supabase]);

  // ── Handle ?episode= param ────────────────────────────────────────────────
  const flattenedEpisodes = useMemo(
    () => seasons.flatMap((s) => s.episodes).filter((e) => Boolean(e.slug)),
    [seasons]
  );

  useEffect(() => {
    const episodeParam = search?.get('episode');
    // Guard: no param, seasons not loaded yet, or already on this episode
    if (!episodeParam || flattenedEpisodes.length === 0) return;
    if (selectedEpisode?.slug === episodeParam) return;

    const match = flattenedEpisodes.find((e) => e.slug === episodeParam);
    if (!match) return;

    const idx = seasons.findIndex((s) =>
      s.episodes.some((e) => e.slug === episodeParam)
    );
    selectEpisode(match, idx >= 0 ? `season-${idx}` : 'season-0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, flattenedEpisodes, seasons]);

  const selectedEpisodeIndex = useMemo(
    () => flattenedEpisodes.findIndex((e) => e.slug === selectedEpisode?.slug),
    [flattenedEpisodes, selectedEpisode?.slug]
  );

  const nextEpisode = flattenedEpisodes[selectedEpisodeIndex + 1] ?? null;

  const getSeasonProgress = (season: Season) => {
    const total = season.episodes.length;
    const watched = season.episodes.filter((e) => e.slug && watchedSlugs.has(e.slug)).length;
    return { total, watched, ratio: total > 0 ? watched / total : 0 };
  };

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

  // ── Player ────────────────────────────────────────────────────────────────
// ── Player ────────────────────────────────────────────────────────────────
  // (only the renderPlayer function changed — pass senderId down)
  const renderPlayer = () => {
    if (isLoadingEpisode) {
      return (
        <div className="rounded-2xl border border-border/70 bg-background/55 p-4 flex items-center gap-3">
          <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
          <p className="text-sm text-muted-foreground">Loading episode source...</p>
        </div>
      );
    }

    if (!episodeSource?.embed) {
      return (
        <p className="text-sm text-muted-foreground">No playable source for this episode.</p>
      );
    }

    return (
      <TuniflixEmbedPlayer
        src={episodeSource.embed}
        title={selectedEpisode?.title || 'Episode player'}
        className="h-[56vw] max-h-[70vh] min-h-75 w-full overflow-hidden rounded-2xl ring-1 ring-border/60"
        externalSyncEvent={externalSyncEvent}
        onPlaybackChange={handlePlaybackChange}
        currentUserId={currentUserId}
        senderId={senderId}  // ✅ share the hook's senderId so YT player self-filters correctly
      />
    );
  };

  if (isLoadingSeries) {
    return (
      <div className="glass-panel rounded-3xl border border-border/70 p-8 flex items-center gap-3">
        <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
        <p className="text-muted-foreground">Loading series...</p>
      </div>
    );
  }

  const hasEpisodes = flattenedEpisodes.length > 0;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* ── Player panel ── */}
      <section className="order-1 glass-panel rounded-3xl border border-border/70 p-5 md:p-6 xl:order-1 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          {selectedEpisode ? (
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <PlayCircle className="h-3.5 w-3.5" />
              Now playing
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select an episode to start.</p>
          )}
        </div>

        <div className="w-full rounded-xl overflow-hidden bg-black/30">
          {renderPlayer()}
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-2 border-t border-border/50">
          {/* Clear vote button */}
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-4 text-sm w-full md:w-auto"
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

          {/* Next episode */}
          {nextEpisode && (
            <button
              type="button"
              onClick={() => {
                const idx = seasons.findIndex((s) =>
                  s.episodes.some((e) => e.slug === nextEpisode.slug)
                );
                selectEpisode(nextEpisode, idx >= 0 ? `season-${idx}` : openSeason);
              }}
              className="group w-full md:w-auto flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-left transition-all hover:bg-background/70 hover:border-border hover:shadow-md"
            >
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Up next</span>
                <span className="text-xs text-muted-foreground">Episode {nextEpisode.number}</span>
              </div>
              <div className="flex items-center justify-center rounded-full bg-muted/50 p-2 transition-all group-hover:translate-x-1 group-hover:bg-muted">
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </div>
            </button>
          )}
        </div>
      </section>

      {/* ── Episode list sidebar ── */}
      <aside className="order-2 glass-panel rounded-3xl border border-border/70 p-4 md:p-6 xl:order-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Tv className="h-3.5 w-3.5" />
          Series
        </p>
        <h1 className="mt-2 text-2xl font-serif font-semibold text-foreground uppercase md:text-3xl break-all">
          {seriesTitle}
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
                            {progress.watched}/{progress.total}
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
                          const isWatched = episode.slug ? watchedSlugs.has(episode.slug) : false;
                          return (
                            <Button
                              key={`${episode.slug ?? episode.title}-${index}`}
                              type="button"
                              variant={isActive ? 'default' : 'outline'}
                              className={[
                                'w-full justify-start text-left transition-colors',
                                isWatched && !isActive ? 'opacity-60' : '',
                              ].join(' ')}
                              disabled={!episode.slug || isLoadingEpisode}
                              onClick={() => selectEpisode(episode, seasonKey)}
                            >
                              {`Episode ${index + 1}`}
                              {isWatched && !isActive && (
                                <span className="ml-auto text-[10px] opacity-60">✓</span>
                              )}
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
