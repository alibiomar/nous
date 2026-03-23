'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, PanInfo } from 'framer-motion';

// ── Page order ────────────────────────────────────────────────────────────────
const PAGE_ORDER = ['/feed', '/messages', '/music', '/cinema'];

interface SwipeNavigatorProps {
  children: React.ReactNode;
  onFeedSwipeRight?: () => void;
}

export function SwipeNavigator({ children, onFeedSwipeRight }: SwipeNavigatorProps) {
  const router = useRouter();
  const pathname = usePathname();

  const getCurrentIndex = useCallback(() => {
    return PAGE_ORDER.findIndex((p) => pathname.startsWith(p));
  }, [pathname]);

  // Framer Motion provides 'info' which already calculates offset and velocity
  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const idx = getCurrentIndex();
    const isOnFeed = pathname.startsWith('/feed');
    
    const dx = info.offset.x;
    const velocityX = info.velocity.x;

    // Trigger if they dragged more than 50px OR swiped fast (velocity > 400)
    const isSwipeRight = dx > 50 || velocityX > 400;
    const isSwipeLeft = dx < -50 || velocityX < -400;

    if (isSwipeRight) {
      if (isOnFeed && onFeedSwipeRight) {
        onFeedSwipeRight();
        return;
      }
      const prev = idx <= 0 ? PAGE_ORDER.length - 1 : idx - 1;
      router.push(PAGE_ORDER[prev]);
      
    } else if (isSwipeLeft) {
      const next = idx === -1 ? 0 : (idx + 1) % PAGE_ORDER.length;
      router.push(PAGE_ORDER[next]);
    }
  };

  return (
    <motion.div
      // 1. Enable horizontal dragging
      drag="x"
      
      // 2. Snap back to original position when let go (if navigation doesn't happen)
      dragConstraints={{ left: 0, right: 0 }}
      
      // 3. How much resistance there is when pulling (0 to 1)
      dragElastic={0.2} 
      
      // 4. Handle the logic when the user releases their finger
      onDragEnd={handleDragEnd}
      
      // touchAction: 'pan-y' ensures vertical scrolling still works perfectly!
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
    >
      {children}
    </motion.div>
  );
}