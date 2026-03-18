// hooks/use-cinema-sync.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/client';
import type { HlsPlaybackPayload } from '@/components/tuniflix-hls-player';

export function useCinemaSync(syncId: string | null) {
  const supabase = createClient();
  const [externalSyncEvent, setExternalSyncEvent] = useState<HlsPlaybackPayload | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `host-${Math.random().toString(36).slice(2)}`
  );

useEffect(() => {
  if (!syncId) return;

  const ch = supabase
    .channel(`cinema-sync-${syncId}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: 'playback' }, (message: { payload: unknown }) => {
      console.log('[cinema-sync] received', message);
      const payload = message.payload as Partial<HlsPlaybackPayload>;
      if (!payload || payload.syncId !== syncId) return;
      if (payload.senderId === senderIdRef.current) return;

      if (payload.action === 'play') setIsPlaying(true);
      if (payload.action === 'pause') setIsPlaying(false);

      setExternalSyncEvent(payload as HlsPlaybackPayload);
    })
    .subscribe((status: string) => {
      console.log('[cinema-sync] status', status);
      if (status === 'SUBSCRIBED') {
        channelRef.current = ch; // ← only assign after confirmed subscribed
      } else {
        channelRef.current = null; // ← clear on any other status
      }
    });

  return () => {
    channelRef.current = null;
    void supabase.removeChannel(ch);
  };
}, [syncId, supabase]);
  // Called by the player when the local user plays/pauses/seeks
const handlePlaybackChange = useCallback(
  async (action: 'play' | 'pause' | 'seek', currentTime: number) => {
    console.log('[sync] handlePlaybackChange called', action, currentTime, 'syncId:', syncId, 'channel:', !!channelRef.current);
    if (!syncId) return;
    const ch = channelRef.current;
    if (!ch) return;
    const result = await ch.send({
      type: 'broadcast',
      event: 'playback',
      payload: {
        syncId,
        senderId: senderIdRef.current,
        action,
        currentTime,
        happenedAt: Date.now(),
      } satisfies HlsPlaybackPayload,
    });
    console.log('[sync] send result:', result);
  },
  [syncId]
);

  return { externalSyncEvent, isPlaying, handlePlaybackChange };
}