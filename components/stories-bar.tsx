'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { StoryViewer } from './story-viewer';

interface Story {
  id: string;
  user_id: string;
  image_url: string;
  video_url: string | null;
  media_type: 'image' | 'video';
  caption: string | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
  youtube_title: string | null;
  youtube_start_sec: number | null;
  youtube_end_sec: number | null;
  created_at: string;
  expires_at: string;
  author: { id: string; name: string; avatar_url: string | null };
}

interface StoriesBarProps {
  currentUserId: string;
  onAddStory: () => void;
  refreshSignal?: number;
}

export function StoriesBar({ currentUserId, onAddStory, refreshSignal }: StoriesBarProps) {
  const [stories, setStories] = useState<Story[]>([]);
  const [viewerAuthorId, setViewerAuthorId] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const fetchStories = async () => {
    try {
      const res = await fetch('/api/stories');
      if (!res.ok) return;
      const data = await res.json() as Story[];
      setStories(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { void fetchStories(); }, [refreshSignal]);

  // Group by author — show one circle per person, with their latest story
  const grouped = stories.reduce<Record<string, Story[]>>((acc, story) => {
    const uid = story.user_id;
    if (!acc[uid]) acc[uid] = [];
    acc[uid].push(story);
    return acc;
  }, {});

  // Order: partner first, then self
  const authorIds = Object.keys(grouped).sort((a) => (a === currentUserId ? 1 : -1));

  const openStories = (authorId: string) => {
    setViewerAuthorId(authorId);
    setSeenIds((prev) => {
      const next = new Set(prev);
      grouped[authorId]?.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const handleDelete = (storyId: string) => {
    setStories((prev) => prev.filter((s) => s.id !== storyId));
  };

  if (stories.length === 0 && authorIds.length === 0) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        <AddCircle onClick={onAddStory} />
        <p className="text-xs text-muted-foreground whitespace-nowrap">No stories yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-none">
        {/* Add story button */}
        <AddCircle onClick={onAddStory} />

        {/* Story circles */}
        {authorIds.map((authorId) => {
          const authorStories = grouped[authorId];
          const latest = authorStories[0];
          const isOwn = authorId === currentUserId;
          const allSeen = authorStories.every((s) => seenIds.has(s.id));

          return (
            <button
              key={authorId}
              type="button"
              onClick={() => openStories(authorId)}
              className="flex flex-col items-center gap-1.5 shrink-0"
            >
              <div
                className={[
                  'h-14 w-14 rounded-full p-0.5 transition-all',
                  allSeen
                    ? 'bg-border/50'
                    : 'bg-linear-to-tr from-primary via-primary/70 to-secondary',
                ].join(' ')}
              >
                <div className="h-full w-full overflow-hidden rounded-full border-2 border-background">
                  {latest.author.avatar_url ? (
                    <img
                      src={latest.image_url}
                      alt={latest.author.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-secondary text-sm font-semibold text-foreground">
                      {latest.author.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground max-w-14 truncate">
                {isOwn ? 'You' : latest.author.name}
              </span>
            </button>
          );
        })}
      </div>

      {viewerAuthorId !== null && grouped[viewerAuthorId] && (
        <StoryViewer
          stories={grouped[viewerAuthorId]}
          initialIndex={0}
          currentUserId={currentUserId}
          onClose={() => setViewerAuthorId(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

function AddCircle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 shrink-0"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-primary/50 bg-primary/10 transition-colors hover:bg-primary/20">
        <Plus className="h-5 w-5 text-primary" />
      </div>
      <span className="text-[10px] text-muted-foreground">Add</span>
    </button>
  );
}