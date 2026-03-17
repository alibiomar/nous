'use client';

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/client';

export function TuniflixHlsPlayer({
  stream,
  className,
  syncId,
  onFatalError,
}: {
  stream: string;
  className?: string;
  syncId?: string;
  onFatalError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const suppressBroadcastRef = useRef(false);
  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cinema-${Math.random().toString(36).slice(2)}`
  );
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!syncId) {
      return;
    }

    const channel = supabase
      .channel('cinema-playback-sync')
      .on('broadcast', { event: 'playback' }, (message: { payload: unknown }) => {
        const payload = message.payload as {
          syncId?: string;
          senderId?: string;
          action?: 'play' | 'pause' | 'seek';
          currentTime?: number;
        };

        if (!videoRef.current) {
          return;
        }

        if (!payload || payload.syncId !== syncId || payload.senderId === senderIdRef.current) {
          return;
        }

        suppressBroadcastRef.current = true;

        const nextTime =
          typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)
            ? Math.max(payload.currentTime, 0)
            : videoRef.current.currentTime;

        if (Math.abs(videoRef.current.currentTime - nextTime) > 1.5) {
          videoRef.current.currentTime = nextTime;
        }

        if (payload.action === 'play') {
          void videoRef.current.play().catch(() => undefined);
        }

        if (payload.action === 'pause') {
          videoRef.current.pause();
        }

        window.setTimeout(() => {
          suppressBroadcastRef.current = false;
        }, 150);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [supabase, syncId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      return;
    }

    setError(null);

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream;
      return;
    }

    if (!Hls.isSupported()) {
      setError('HLS playback is not supported in this browser.');
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });

    hls.loadSource(stream);
    hls.attachMedia(video);

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setError('Failed to play stream.');
        onFatalError?.();
        hls.destroy();
      }
    });

    return () => {
      hls.destroy();
    };
  }, [stream, onFatalError]);

  useEffect(() => {
    const video = videoRef.current;
    const channel = channelRef.current;

    if (!video || !channel || !syncId) {
      return;
    }

    const broadcast = async (action: 'play' | 'pause' | 'seek') => {
      if (suppressBroadcastRef.current) {
        return;
      }

      await channel.send({
        type: 'broadcast',
        event: 'playback',
        payload: {
          syncId,
          senderId: senderIdRef.current,
          action,
          currentTime: video.currentTime,
          happenedAt: Date.now(),
        },
      });
    };

    const onPlay = () => {
      void broadcast('play');
    };
    const onPause = () => {
      void broadcast('pause');
    };
    const onSeeked = () => {
      void broadcast('seek');
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [syncId, stream]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        controls
        playsInline
        className="h-full w-full rounded-xl bg-black"
      />
      {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
    </div>
  );
}
