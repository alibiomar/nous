'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music, X, ChevronLeft, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface Story {
  id: string;
  user_id: string;
  image_url: string;
  video_url: string | null;
  media_type: 'image' | 'video';
  caption: string | null;
  youtube_url: string | null;       // keep for backward compat
  youtube_video_id: string | null;  // new
  youtube_title: string | null;
  youtube_start_sec: number | null; // new
  youtube_end_sec: number | null;   // new
  created_at: string;
  expires_at: string;
  author: { id: string; name: string; avatar_url: string | null };
}

interface StoryViewerProps {
  stories: Story[];
  initialIndex: number;
  currentUserId: string; // pass the logged-in user's id
  onClose: () => void;
  onDelete?: (storyId: string) => void; // optional callback after deletion
}

interface YTPlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
}
interface StoryYTNamespace {
  Player: new (el: HTMLElement, opts: object) => YTPlayer;
  PlayerState: { PLAYING: number };
}

let ytApiPromise: Promise<StoryYTNamespace> | null = null;
function loadYT(): Promise<StoryYTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT as StoryYTNamespace);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); window.YT?.Player ? resolve(window.YT as StoryYTNamespace) : reject(); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject();
      document.body.appendChild(s);
    }
  });
  return ytApiPromise;
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    return u.searchParams.get('v');
  } catch { return null; }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h === 1) return '1h ago';
  return `${h}h ago`;
}

function expiresIn(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const h = Math.ceil(diff / 3_600_000);
  if (h <= 0) return 'expired';
  if (h === 1) return '< 1h left';
  return `${h}h left`;
}

export function StoryViewer({ stories, initialIndex, currentUserId, onClose, onDelete }: StoryViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const story = stories[index];

  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationMs = story?.media_type === 'video' ? 30_000 : 8_000;

  const isOwnStory = story?.user_id === currentUserId;

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Progress bar
  useEffect(() => {
    setProgress(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const step = 100 / (durationMs / 100);
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(progressTimerRef.current!);
          if (index < stories.length - 1) setIndex((i) => i + 1);
          else onClose();
          return 100;
        }
        return p + step;
      });
    }, 100);
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // ── YouTube autoplay — safe cleanup avoids removeChild errors
useEffect(() => {
  // Resolve video ID from new column, falling back to parsing legacy youtube_url
  const videoId =
    story.youtube_video_id ??
    (story.youtube_url ? extractVideoId(story.youtube_url) : null);
  const startSec = story.youtube_start_sec ?? 0;

  if (!videoId || !ytContainerRef.current) return;

  const mountEl = document.createElement('div');
  ytContainerRef.current.appendChild(mountEl);

  let cancelled = false;
  let player: YTPlayer | null = null;

  loadYT().then((YT: StoryYTNamespace) => {
    if (cancelled || !mountEl.isConnected) return;
    player = new YT.Player(mountEl, {
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        loop: 1,
        playlist: videoId,
        mute: 1,
        start: Math.floor(startSec), // seek to the chosen clip start
      },
      events: {
        onReady: (e: { target: YTPlayer & { unMute?: () => void; setVolume?: (v: number) => void } }) => {
          if (cancelled) return;
          e.target.playVideo();
          setTimeout(() => {
            if (!cancelled) {
              e.target.unMute?.();
              e.target.setVolume?.(100);
            }
          }, 300);
        },
      },
    });
    ytPlayerRef.current = player;
  }).catch(() => undefined);

  return () => {
    cancelled = true;
    try { if (mountEl.parentNode) mountEl.parentNode.removeChild(mountEl); } catch { /* ignore */ }
    try { player?.destroy(); } catch { /* ignore */ }
    ytPlayerRef.current = null;
  };
}, [story.youtube_video_id, story.youtube_url, story.youtube_start_sec]);
//  ^^^ depend on the new fields so it re-initialises when index changes

  const goTo = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= stories.length) return;
    setIndex(newIndex);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goTo(index + 1);
      if (e.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (mounted && !story) onClose();
  }, [mounted, story, onClose]);

  // ── Delete handler
  const handleDelete = async () => {
    if (!story || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/stories?id=${story.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      onDelete?.(story.id);
      // Move to next story or close
      if (stories.length <= 1) {
        onClose();
      } else if (index < stories.length - 1) {
        goTo(index); // same index now points to next story after parent removes deleted one
      } else {
        goTo(index - 1);
      }
    } catch (err) {
      console.error('Failed to delete story:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!mounted || !story) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
        <X className="h-5 w-5" />
      </button>
      {index > 0 && (
        <button type="button" onClick={() => goTo(index - 1)} className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {index < stories.length - 1 && (
        <button type="button" onClick={() => goTo(index + 1)} className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      <div className="relative mx-auto h-[90vh] w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl">
        {/* Progress bars */}
        <div className="absolute left-0 right-0 top-0 z-20 flex gap-1 p-3">
          {stories.map((_, i) => (
            <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div className="h-full rounded-full bg-white transition-none" style={{ width: i < index ? '100%' : i === index ? `${progress}%` : '0%' }} />
            </div>
          ))}
        </div>

        {/* Author row */}
        <div className="absolute left-0 right-0 top-6 z-20 flex items-center justify-between px-4 pt-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 overflow-hidden rounded-full border border-white/40 bg-white/20">
              {story.author.avatar_url ? (
                <img src={story.author.avatar_url} alt={story.author.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white">
                  {story.author.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-white drop-shadow">{story.author.name}</span>
              <span className="text-[10px] text-white/70">{timeAgo(story.created_at)} · {expiresIn(story.expires_at)}</span>
            </div>
          </div>

          {/* 3-dot delete menu — only for own stories */}
          {isOwnStory && (
            <DropdownMenu >
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-white hover:bg-white/20 focus-visible:bg-white/20"
                  disabled={isDeleting}
                  aria-label="Story actions"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className='z-60'
                >
                  <Trash2 className="size-3" />
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Media */}
        {story.media_type === 'video' && story.video_url ? (
          <video src={story.video_url} className="h-full w-full object-cover" autoPlay playsInline loop muted={!!story.youtube_url} />
        ) : (
          <img src={story.image_url} alt={story.caption ?? 'Story'} className="h-full w-full object-cover" />
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />

        {story.caption && (
          <div className="absolute bottom-16 left-0 right-0 px-5">
            <p className="text-center text-sm font-medium leading-relaxed text-white drop-shadow-lg">{story.caption}</p>
          </div>
        )}

        {(story.youtube_video_id || story.youtube_url) && (
  <div className="absolute bottom-5 left-0 right-0 flex justify-center">
    <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
      <Music className="h-3 w-3 animate-pulse text-primary" />
      <span className="text-xs text-white/90 truncate max-w-45">
        {story.youtube_title ?? 'Playing music'}
      </span>
    </div>
  </div>
)}

        {/* YT container — kept in DOM so player mounts correctly */}
        <div
          ref={ytContainerRef}
          aria-hidden="true"
          className="absolute pointer-events-none"
          style={{ width: 1, height: 1, opacity: 0, left: -9999, top: 0 }}
        />
      </div>
    </div>,
    document.body
  );
}