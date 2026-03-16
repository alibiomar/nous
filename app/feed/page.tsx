"use client";

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PhotoFeed } from '@/components/photo-feed';
import { SharePhotoModal } from '@/components/share-photo-modal';
import { Button } from '@/components/ui/button';

export default function FeedPage() {
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-serif font-semibold text-foreground">Feed</h1>
          <Button
            type="button"
            size="icon"
            onClick={() => setIsShareModalOpen(true)}
            aria-label="Share a photo"
            title="Share a photo"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-2">Share and view your moments together</p>
      </div>

      <SharePhotoModal
        open={isShareModalOpen}
        onOpenChange={setIsShareModalOpen}
        onPosted={() => setRefreshSignal((current) => current + 1)}
      />

      {/* Photo Feed Content */}
      <PhotoFeed refreshSignal={refreshSignal} />
    </div>
  );
}
