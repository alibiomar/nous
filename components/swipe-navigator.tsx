'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// ── Page order ────────────────────────────────────────────────────────────────
// Circular: feed → messages → music → cinema → feed (wraps)
// Swipe left on feed = open story creator (special case, no navigation)
const PAGE_ORDER = ['/feed', '/messages', '/music', '/cinema'];

const SWIPE_THRESHOLD    = 60;   // px minimum horizontal travel
const SWIPE_MAX_VERTICAL = 80;   // px — reject if too vertical (scrolling)
const SWIPE_MIN_VELOCITY = 0.3;  // px/ms

interface SwipeNavigatorProps {
  children: React.ReactNode;
  onFeedSwipeRight ?: () => void; // opens story creator instead of navigating
}

export function SwipeNavigator({ children, onFeedSwipeRight  }: SwipeNavigatorProps) {
  const router   = useRouter();
  const pathname = usePathname();

  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);

  const getCurrentIndex = useCallback(() => {
    return PAGE_ORDER.findIndex((p) => pathname.startsWith(p));
  }, [pathname]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    const t   = e.changedTouches[0];
    const dx  = t.clientX - touchStart.current.x;
    const dy  = t.clientY - touchStart.current.y;
    const dt  = Date.now() - touchStart.current.t;
    touchStart.current = null;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDy > SWIPE_MAX_VERTICAL)  return; // too vertical — probably scrolling
    if (absDx < SWIPE_THRESHOLD)     return; // too short
    if (absDx / dt < SWIPE_MIN_VELOCITY) return; // too slow
    if (absDx < absDy * 1.5)         return; // not horizontal enough

    const idx       = getCurrentIndex();
    const swipeRight  = dx > 0;
    const isOnFeed  = pathname.startsWith('/feed');

    if (swipeRight) {
      // ── Swipe right: forward ───────────────────────────────────────────────
      if (isOnFeed && onFeedSwipeRight ) {
        // Special case: open story creator instead of navigating
        onFeedSwipeRight ();
        return;
      }
      // Circular: last page wraps back to first
      const next = idx === -1 ? 0 : (idx + 1) % PAGE_ORDER.length;
      router.push(PAGE_ORDER[next]);
    } else {
      // ── Swipe right: backward (circular) ─────────────────────────────────
      const prev = idx <= 0 ? PAGE_ORDER.length - 1 : idx - 1;
      router.push(PAGE_ORDER[prev]);
    }
  }, [getCurrentIndex, onFeedSwipeRight , pathname, router]);

  useEffect(() => {
    const el = document.documentElement;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend',   handleTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend',   handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);

  return <>{children}</>;
}
