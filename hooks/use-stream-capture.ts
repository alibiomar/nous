import { useEffect, useRef, useState } from 'react';

export function useStreamCapture(embedUrl: string | null) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!embedUrl) return;

    setStreamUrl(null);
    setError(null);
    setLoading(true);

    // Register service worker if not already
    if (!('serviceWorker' in navigator)) {
      setError('Stream capture not supported in this browser.');
      setLoading(false);
      return;
    }

    let swRegistration: ServiceWorkerRegistration | null = null;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'M3U8_CAPTURED') {
        const url: string = event.data.url;
        // Filter out playlist variants — we want the master
        if (url.includes('master.m3u8') || url.endsWith('.m3u8')) {
          setStreamUrl(url);
          setLoading(false);
          cleanup();
        }
      }
    };

    const cleanup = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      if (iframeRef.current) {
        document.body.removeChild(iframeRef.current);
        iframeRef.current = null;
      }
    };

    const start = async () => {
      try {
        swRegistration = await navigator.serviceWorker.register('/sw-stream-capture.js', {
          scope: '/',
        });
        await navigator.serviceWorker.ready;

        navigator.serviceWorker.addEventListener('message', onMessage);

        // Hidden iframe loads the embed — its network requests go through SW
        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(iframe);
        iframeRef.current = iframe;

        // Timeout if no m3u8 found within 15s
        timeoutRef.current = setTimeout(() => {
          setError('Could not find stream.');
          setLoading(false);
          cleanup();
        }, 15000);

      } catch (err) {
        console.error('Stream capture error:', err);
        setError('Failed to capture stream.');
        setLoading(false);
      }
    };

    void start();

    return cleanup;
  }, [embedUrl]);

  return { streamUrl, loading, error };
}