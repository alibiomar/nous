'use client';

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/client';

const SEEK_THRESHOLD = 2;
const SUPPRESS_MS = 200;
const MAX_RECOVERY = 3;

type PlaybackAction = 'play' | 'pause' | 'seek';

export interface HlsPlaybackPayload {
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
  // NEW: accept an external sync event from the parent (same pattern as YouTubeSyncPlayer)
  externalSyncEvent,
  // NEW: tell the parent about local play/pause/seek so it can broadcast and update UI
  onPlaybackChange,
  onFatalError,
  embedReferer,
}: {
  stream: string;
  className?: string;
  syncId?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
  onFatalError?: () => void;
  embedReferer?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const recoveryAttemptsRef = useRef(0);
  // Track whether we're applying a remote sync so we don't re-broadcast it
  const applyingRemoteSyncRef = useRef(false);

  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cinema-${Math.random().toString(36).slice(2)}`
  );

  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);

  const suppress = useCallback(() => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressRef.current = true;
    suppressTimerRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, SUPPRESS_MS);
  }, []);

  // ── Apply external sync events from the parent ────────────────────────────
  // This mirrors how YouTubeSyncPlayer receives syncEvent as a prop
  useEffect(() => {
    const video = videoRef.current;
    if (!externalSyncEvent || !video) return;
    // Ignore our own events (parent re-routes our broadcasts back down)
    if (externalSyncEvent.senderId === senderIdRef.current) return;

    suppress();
    applyingRemoteSyncRef.current = true;

    const remoteTime = Number.isFinite(externalSyncEvent.currentTime)
      ? Math.max(externalSyncEvent.currentTime, 0)
      : null;

    const latencyOffset = externalSyncEvent.happenedAt
      ? (Date.now() - externalSyncEvent.happenedAt) / 1000
      : 0;

    if (remoteTime !== null && Math.abs(video.currentTime - remoteTime) > SEEK_THRESHOLD) {
      video.currentTime = remoteTime + (externalSyncEvent.action === 'play' ? latencyOffset : 0);
    }

    if (externalSyncEvent.action === 'play') {
      void video.play().catch(() => undefined);
    } else if (externalSyncEvent.action === 'pause') {
      video.pause();
    }

    const t = setTimeout(() => { applyingRemoteSyncRef.current = false; }, 250);
    return () => clearTimeout(t);
  }, [externalSyncEvent, suppress]);

  // ── HLS setup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    setError(null);
    setBuffering(true);
    recoveryAttemptsRef.current = 0;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream;
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
      xhrSetup: embedReferer
        ? (xhr) => { xhr.setRequestHeader('Referer', embedReferer); }
        : undefined,
    });

    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.loadSource(stream);
    hls.on(Hls.Events.MANIFEST_PARSED, () => setBuffering(false));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (recoveryAttemptsRef.current < MAX_RECOVERY) {
              recoveryAttemptsRef.current += 1;
              hls.startLoad();
            } else {
              setError('Failed to play stream.');
              onFatalError?.();
              hls.destroy();
              hlsRef.current = null;
            }
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
  }, [stream, embedReferer, onFatalError]);

  // ── Broadcast outgoing events ─────────────────────────────────────────────
  // Now calls onPlaybackChange so the parent owns the channel + state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const notify = (action: PlaybackAction) => {
      if (suppressRef.current || applyingRemoteSyncRef.current) return;
      onPlaybackChange?.(action, video.currentTime);
    };

    const onPlay    = () => notify('play');
    const onPause   = () => notify('pause');
    const onSeeked  = () => notify('seek');
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);

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
  }, [onPlaybackChange]);

  // ── Volume persistence ────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saved = localStorage.getItem('tuniflix-volume');
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (Number.isFinite(parsed)) video.volume = Math.min(1, Math.max(0, parsed));
    }
    const onVolumeChange = () => localStorage.setItem('tuniflix-volume', String(video.volume));
    video.addEventListener('volumechange', onVolumeChange);
    return () => video.removeEventListener('volumechange', onVolumeChange);
  }, []);

  useEffect(() => {
    return () => { if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current); };
  }, []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <video ref={videoRef} controls playsInline className="h-full w-full rounded-xl bg-black" />
      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 pointer-events-none">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}