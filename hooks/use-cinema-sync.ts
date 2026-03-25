// hooks/use-cinema-sync.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/client';
import type { HlsPlaybackPayload } from '@/components/tuniflix-embed-player';

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

  // Expose senderId so TuniflixEmbedPlayer can share the same identity
  // and avoid double-filtering its own echoes.
  const senderId = senderIdRef.current;

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

        // ✅ Spread into a NEW object with a unique receivedAt stamp so that
        //    React always sees a changed reference and re-renders consumers,
        //    even when two consecutive events share the same action/currentTime.
        const stamped: HlsPlaybackPayload = {
          ...(payload as HlsPlaybackPayload),
          receivedAt: Date.now(),
        };
        setExternalSyncEvent(stamped);
        console.log('[cinema-sync] set externalSyncEvent:', stamped);
      })
      .subscribe((status: string) => {
        console.log('[cinema-sync] status', status);
        if (status === 'SUBSCRIBED') {
          channelRef.current = ch;
        } else {
          channelRef.current = null;
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [syncId, supabase]);

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

  return { externalSyncEvent, isPlaying, handlePlaybackChange, senderId };
}