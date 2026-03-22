'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { SwipeNavigator } from '@/components/swipe-navigator';

const StoryCreator = dynamic(() => import('@/components/story-creator').then((m) => m.StoryCreator), { ssr: false })

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [storyCreatorOpen, setStoryCreatorOpen] = useState(false);

  const isOnFeed = pathname.startsWith('/feed');

  return (
    <SwipeNavigator
      onFeedSwipeRight ={isOnFeed ? () => setStoryCreatorOpen(true) : undefined}
    >
      {children}

      {/* Story creator — triggered by swipe right on feed */}
      {storyCreatorOpen && (
        <StoryCreator
          open={storyCreatorOpen}
          onClose={() => setStoryCreatorOpen(false)}
        />
      )}
    </SwipeNavigator>
  );
}
