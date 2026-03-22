'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { SwipeNavigator } from '@/components/swipe-navigator';
import { StoryCreator } from '@/components/story-creator';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [storyCreatorOpen, setStoryCreatorOpen] = useState(false);

  const isOnFeed = pathname.startsWith('/feed');

  return (
    <SwipeNavigator
      onFeedSwipeLeft={isOnFeed ? () => setStoryCreatorOpen(true) : undefined}
    >
      {children}

      {/* Story creator — triggered by swipe left on feed */}
      <StoryCreator
        open={storyCreatorOpen}
        onClose={() => setStoryCreatorOpen(false)}
      />
    </SwipeNavigator>
  );
}
