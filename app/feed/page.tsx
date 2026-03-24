"use client";

import { useState } from 'react';
import { Clock3, Plus, Sparkles } from 'lucide-react';
import { PhotoFeed } from '@/components/photo-feed';
import { SharePhotoModal } from '@/components/share-photo-modal';
import { StoriesBar } from '@/components/stories-bar';
import { StoryCreator } from '@/components/story-creator';
import { Button } from '@/components/ui/button';
import { useUser } from '@/contexts/user';

export default function FeedPage() {
  const { user } = useUser();
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isStoryCreatorOpen, setIsStoryCreatorOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [storiesRefreshSignal, setStoriesRefreshSignal] = useState(0);

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="glass-panel relative overflow-hidden rounded-3xl border border-border/70 p-5 md:p-7">
                <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-secondary/60 blur-2xl" />

        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          
          <div>
            
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your social timeline</p>
            <h1 className="mt-2 text-3xl font-serif font-semibold text-foreground md:text-4xl">Moments</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
              Share tiny moments, see what your person posted, and keep your story in one private place.
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="h-11 rounded-2xl px-5"
            onClick={() => setIsShareModalOpen(true)}
            aria-label="Share a photo"
            title="Share a photo"
          >
            <Plus className="mr-2 h-5 w-5" />
            Share moment
          </Button>
        </div>
      </section>

      {/* ── Stories ── */}
      <section className="glass-panel rounded-3xl p-4 md:p-5">
        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Stories</p>
        <StoriesBar
          currentUserId={user?.id ?? ''}
          onAddStory={() => setIsStoryCreatorOpen(true)}
          refreshSignal={storiesRefreshSignal}
        />
      </section>

      <StoryCreator
        open={isStoryCreatorOpen}
        onClose={() => setIsStoryCreatorOpen(false)}
        onPosted={() => setStoriesRefreshSignal((s) => s + 1)}
      />

      <SharePhotoModal
        open={isShareModalOpen}
        onOpenChange={setIsShareModalOpen}
        onPosted={() => setRefreshSignal((current) => current + 1)}
      />

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="glass-panel rounded-3xl p-4 md:p-5">
          <PhotoFeed refreshSignal={refreshSignal} 
                    currentUserId={user?.id ?? ''}
/>
        </div>

        <aside className="glass-panel hidden rounded-3xl p-5 lg:block">
          <h2 className="text-lg font-semibold text-foreground">Posting tips</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Capture one meaningful frame instead of many random shots.
            </li>
            <li className="flex items-start gap-2">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Post in the moment to keep your timeline real and alive.
            </li>
          </ul>
        </aside>
      </section>
    </div>
  );
}