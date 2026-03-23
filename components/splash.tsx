'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/contexts/user';
import { prefetchMessages } from '@/lib/message-prefetch-cache';

export default function Splash({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const [ready, setReady] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function warmup() {
      try {
        const promises: Promise<unknown>[] = [];
        promises.push(fetch('/api/stories', { cache: 'no-store' }).catch(() => null));
        if (user) {
          promises.push(prefetchMessages());
          promises.push(fetch('/api/messages/unread-count', { cache: 'no-store' }).catch(() => null));
        }
        // Preload core assets
        for (const src of ['/logo.svg', '/animated_heart_icon.svg']) {
          const img = new Image();
          img.src = src;
        }
        // Warm up YouTube API
        if (typeof window !== 'undefined' && !document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          s.async = true;
          document.head.appendChild(s);
        }
        await Promise.all(promises);
      } catch {
        // ignore
      } finally {
        if (mounted) {
          // Fade out gracefully before removing
          setFadeOut(true);
          setTimeout(() => { if (mounted) setReady(true); }, 500);
        }
      }
    }

    if (!isLoading) warmup();
    return () => { mounted = false; };
  }, [user, isLoading]);

  const showSplash = isLoading || !ready;

  return (
    <div className="relative min-h-svh">
      {children}

      {showSplash && (
        <div
          className="fixed inset-0 z-9999 flex flex-col items-center justify-center"
          style={{
            background: 'var(--background)',
            opacity: fadeOut ? 0 : 1,
            transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: fadeOut ? 'none' : 'auto',
          }}
        >
          {/* Soft ambient glows matching the app palette */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <div
              className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full blur-3xl opacity-30"
              style={{ background: 'var(--primary)' }}
            />
            <div
              className="absolute bottom-0 right-0 h-64 w-64 rounded-full blur-3xl opacity-20"
              style={{ background: 'var(--secondary)' }}
            />
            <div
              className="absolute bottom-16 left-0 h-48 w-48 rounded-full blur-3xl opacity-15"
              style={{ background: 'var(--primary)' }}
            />
          </div>

          {/* Center content */}
          <div className="relative flex flex-col items-center gap-6 select-none">

              <img
                src="/animated_heart_icon.svg"
                alt="Nous"
                className="h-40 w-auto drop-shadow-lg"
                draggable={false}
              />

            {/* Loading indicator */}

              <div
                className="h-2 w-16 overflow-hidden rounded-full"
                style={{ background: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: '40%',
                    background: 'var(--primary)',
                    animation: 'splash-shimmer 1.4s ease-in-out infinite',
                  }}
                />
            </div>
          </div>

          <style>{`
            @keyframes splash-breathe {
              0%, 100% { transform: scale(1);    opacity: 1;    }
              50%       { transform: scale(1.04); opacity: 0.92; }
            }
            @keyframes splash-shimmer {
              0%   { transform: translateX(-120%); opacity: 0.6; }
              50%  { opacity: 1; }
              100% { transform: translateX(280%);  opacity: 0.6; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}