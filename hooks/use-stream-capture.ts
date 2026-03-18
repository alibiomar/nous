import { useEffect, useRef, useState } from 'react';

// Platforms that never serve HLS — skip capture entirely and go straight to iframe
const IFRAME_ONLY_PATTERNS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'dailymotion.com',
  'vimeo.com',
  'facebook.com',
  'fb.watch',
];

function isIframeOnlyEmbed(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return IFRAME_ONLY_PATTERNS.some((p) => host === p || host.endsWith('.' + p));
  } catch {
    return false;
  }
}

export type StreamCaptureResult =
  | { type: 'hls'; streamUrl: string }   // captured m3u8 — use TuniflixHlsPlayer
  | { type: 'iframe' }                   // no hls found — use iframe embed directly
  | { type: 'loading' }                  // still trying
  | { type: 'error'; message: string };  // SW not supported etc.

export function useStreamCapture(embedUrl: string | null) {
  const [result, setResult] = useState<StreamCaptureResult>({ type: 'loading' });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Legacy shape kept for backwards compat with existing page code
  const streamUrl = result.type === 'hls' ? result.streamUrl : null;
  const loading = result.type === 'loading';
  const error = result.type === 'error' ? result.message : null;

  useEffect(() => {
    if (!embedUrl) {
      setResult({ type: 'loading' });
      return;
    }

    setResult({ type: 'loading' });

    // ── Fast-path: known iframe-only platform ─────────────────────────────
    if (isIframeOnlyEmbed(embedUrl)) {
      setResult({ type: 'iframe' });
      return;
    }

    // ── Service worker not available ──────────────────────────────────────
    if (!('serviceWorker' in navigator)) {
      setResult({ type: 'iframe' });
      return;
    }

    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      if (iframeRef.current) {
        try { document.body.removeChild(iframeRef.current); } catch { /* already removed */ }
        iframeRef.current = null;
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (cancelled) return;
      if (event.data?.type === 'M3U8_CAPTURED') {
        const url: string = event.data.url;
        if (url.includes('.m3u8')) {
          setResult({ type: 'hls', streamUrl: url });
          cleanup();
        }
      }
    };

    const start = async () => {
      try {
        await navigator.serviceWorker.register('/sw-stream-capture.js', { scope: '/' });
        await navigator.serviceWorker.ready;

        if (cancelled) return;

        navigator.serviceWorker.addEventListener('message', onMessage);

        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.style.cssText =
          'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
        document.body.appendChild(iframe);
        iframeRef.current = iframe;

        // Shorter timeout — if no m3u8 in 10s, the embed is probably not HLS
        timeoutRef.current = setTimeout(() => {
          if (!cancelled) setResult({ type: 'iframe' }); // graceful fallback, not an error
          cleanup();
        }, 10000);
      } catch (err) {
        if (!cancelled) {
          console.error('Stream capture error:', err);
          setResult({ type: 'iframe' }); // SW failed — fall back to iframe silently
        }
      }
    };

    void start();

    return cleanup;
  }, [embedUrl]);

  return { streamUrl, loading, error, result };
}