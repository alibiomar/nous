'use client';

import { useEffect, useRef, useState } from 'react';

const SEEK_THRESHOLD = 2;
const SUPPRESS_MS = 300;

type PlaybackAction = 'play' | 'pause' | 'seek';

export interface HlsPlaybackPayload {
  syncId: string;
  senderId: string;
  action: PlaybackAction;
  currentTime: number;
  happenedAt: number;
}

export function TuniflixEmbedPlayer({
  src,
  title,
  className,
  externalSyncEvent,
  onPlaybackChange,
}: {
  src: string;
  title?: string;
  className?: string;
  externalSyncEvent?: HlsPlaybackPayload | null;
  onPlaybackChange?: (action: PlaybackAction, currentTime: number) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentTimeRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const suppressRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const senderIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `embed-${Math.random().toString(36).slice(2)}`
  );

  const [buffering, setBuffering] = useState(true);

  const suppress = () => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressRef.current = true;
    suppressTimerRef.current = setTimeout(() => {
      suppressRef.current = false;
    }, SUPPRESS_MS);
  };

  const postToPlayer = (method: string, value?: number) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const msg: Record<string, unknown> = { method };
    if (value !== undefined) msg.value = value;
    win.postMessage(JSON.stringify(msg), '*');
  };

  // ── Listen for JWPlayer events via postMessage ────────────────────────────
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;

        // Position updates — keep ref current
        if (typeof data.position === 'number') {
          currentTimeRef.current = data.position;
        }

        // Player ready
        if (data.event === 'ready') {
          setBuffering(false);
          return;
        }

        // Don't re-broadcast events we triggered ourselves
        if (applyingRemoteRef.current || suppressRef.current) return;

        if (data.event === 'play') {
          onPlaybackChange?.('play', currentTimeRef.current);
        } else if (data.event === 'pause') {
          onPlaybackChange?.('pause', currentTimeRef.current);
        } else if (data.event === 'seek') {
          onPlaybackChange?.('seek', typeof data.position === 'number' ? data.position : currentTimeRef.current);
        } else if (data.event === 'buffer') {
          setBuffering(true);
        } else if (data.event === 'bufferFull' || data.event === 'firstFrame') {
          setBuffering(false);
        }
      } catch {
        // ignore non-JSON or unrelated messages
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPlaybackChange]);

  // ── Poll position from JWPlayer every second ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      postToPlayer('getPosition');
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Apply external sync events ────────────────────────────────────────────
  useEffect(() => {
    if (!externalSyncEvent || !iframeRef.current?.contentWindow) return;
    if (externalSyncEvent.senderId === senderIdRef.current) return;

    suppress();
    applyingRemoteRef.current = true;

    const remoteTime = Number.isFinite(externalSyncEvent.currentTime)
      ? Math.max(externalSyncEvent.currentTime, 0)
      : null;

    const latencyOffset = externalSyncEvent.happenedAt
      ? (Date.now() - externalSyncEvent.happenedAt) / 1000
      : 0;

    if (remoteTime !== null && Math.abs(currentTimeRef.current - remoteTime) > SEEK_THRESHOLD) {
      const seekTime = remoteTime + (externalSyncEvent.action === 'play' ? latencyOffset : 0);
      postToPlayer('seek', seekTime);
    }

    if (externalSyncEvent.action === 'play') {
      postToPlayer('play');
    } else if (externalSyncEvent.action === 'pause') {
      postToPlayer('pause');
    }

    const t = setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 300);
    return () => clearTimeout(t);
  }, [externalSyncEvent]);

  // ── Cleanup suppress timer ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    };
  }, []);

  return (
    <div className={`relative ${className ?? ''}`}>
      <iframe
        ref={iframeRef}
        src={src}
        className="h-full w-full rounded-xl"
        allowFullScreen
        title={title || 'Video player'}
        // Required for JWPlayer postMessage to work
        allow="autoplay; fullscreen"
      />
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 pointer-events-none">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}
    </div>
  );
}
