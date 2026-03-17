'use client';

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/client';
import { proxyStream } from '@/lib/proxy-stream';

// How far apart (seconds) before we force a seek on the remote peer
const SEEK_THRESHOLD = 2;
// Suppress re-broadcasting for this long after receiving a remote event
const SUPPRESS_MS = 200;

type PlaybackAction = 'play' | 'pause' | 'seek';

interface PlaybackPayload {
  syncId: string;
  senderId: string;
  action: PlaybackAction;
  currentTime: number;
  happenedAt: number;
}

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

  // Keep channel in state so the broadcast useEffect can properly depend on it
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cinema-${Math.random().toString(36).slice(2)}`
  );

  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);

  const supabase = createClient();

  // --- Suppress helper ---
  const suppress = useCallback(() => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressRef.current = true;
    suppressTimerRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, SUPPRESS_MS);
  }, []);

  // --- Supabase sync channel ---
  useEffect(() => {
    if (!syncId) return;

    const ch = supabase
      .channel(`cinema-sync-${syncId}`) // scoped channel per syncId, not global
      .on('broadcast', { event: 'playback' }, (message: { payload: unknown }) => {
        const payload = message.payload as Partial<PlaybackPayload>;
        const video = videoRef.current;

        if (
          !video ||
          !payload ||
          payload.syncId !== syncId ||
          payload.senderId === senderIdRef.current
        ) return;

        suppress();

        const remoteTime = typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)
          ? Math.max(payload.currentTime, 0)
          : null;

        // Account for transmission delay on seeks
        const latencyOffset = payload.happenedAt
          ? (Date.now() - payload.happenedAt) / 1000
          : 0;

        if (remoteTime !== null && Math.abs(video.currentTime - remoteTime) > SEEK_THRESHOLD) {
          video.currentTime = remoteTime + (payload.action === 'play' ? latencyOffset : 0);
        }

        if (payload.action === 'play') {
          void video.play().catch(() => undefined);
        } else if (payload.action === 'pause') {
          video.pause();
        }
      })
      .subscribe();

    setChannel(ch);

    return () => {
      setChannel(null);
      void supabase.removeChannel(ch);
    };
  }, [supabase, syncId, suppress]);

  // --- HLS setup ---
useEffect(() => {
  const video = videoRef.current;
  if (!video || !stream) return;

  setError(null);
  setBuffering(true);

  if (hlsRef.current) {
    hlsRef.current.destroy();
    hlsRef.current = null;
  }

  // Safari native HLS
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = proxyStream(stream);
    return () => { video.src = ''; };
  }

  if (!Hls.isSupported()) {
    setError('HLS playback is not supported in this browser.');
    setBuffering(false);
    return;
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 30,
  });

  hlsRef.current = hls;
  hls.attachMedia(video);             // ✅ attach before loadSource
  hls.loadSource(proxyStream(stream)); // ✅ then load

  hls.on(Hls.Events.MANIFEST_PARSED, () => setBuffering(false));

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          setError('Failed to play stream.');
          onFatalError?.();
          hls.destroy();
          hlsRef.current = null;
      }
    }
  });

  return () => {
    hls.destroy();
    hlsRef.current = null;
  };
}, [stream, onFatalError]);
  // --- Broadcast outgoing events ---
  // Now correctly depends on `channel` (state), not a ref
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !channel || !syncId) return;

    const broadcast = (action: PlaybackAction) => {
      if (suppressRef.current) return;

      void channel.send({
        type: 'broadcast',
        event: 'playback',
        payload: {
          syncId,
          senderId: senderIdRef.current,
          action,
          currentTime: video.currentTime,
          happenedAt: Date.now(),
        } satisfies PlaybackPayload,
      });
    };

    const onPlay  = () => broadcast('play');
    const onPause = () => broadcast('pause');
    const onSeeked = () => broadcast('seek');

    // Buffering state via native video events
    const onWaiting  = () => setBuffering(true);
    const onCanPlay  = () => setBuffering(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
    };
  }, [channel, syncId]);

  // --- Volume persistence ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const saved = localStorage.getItem('tuniflix-volume');
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (Number.isFinite(parsed)) {
        video.volume = Math.min(1, Math.max(0, parsed));
      }
    }

    const onVolumeChange = () => {
      localStorage.setItem('tuniflix-volume', String(video.volume));
    };

    video.addEventListener('volumechange', onVolumeChange);
    return () => video.removeEventListener('volumechange', onVolumeChange);
  }, []);

  // --- Cleanup suppress timer on unmount ---
  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    };
  }, []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <video
        ref={videoRef}
        controls
        playsInline
        className="h-full w-full rounded-xl bg-black"
      />

      {/* Buffering spinner */}
      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 pointer-events-none">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-error">{error}</p>
      )}
    </div>
  );
}