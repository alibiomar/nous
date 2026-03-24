'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser, type User } from '@/contexts/user';
import { writeDeviceCache } from '@/lib/device-cache';

const WARMUP_IMAGES = ['/logo.svg', '/animated_heart_icon.svg'];

// 1. Pass an optional userId parameter to the warmup function
async function runWarmup(userId?: string): Promise<void> {
  // Preload images
  for (const src of WARMUP_IMAGES) {
    const img = new Image();
    img.src = src;
  }

  // Inject YouTube script
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  }

  // 2. Define standard preloads (removed the duplicate WARMUP_FETCHES)
  const preloads = [
    { url: '/api/posts', cacheKey: 'nous:feed:posts', ttl: 30_000 },
    { url: '/api/stories', cacheKey: 'nous:stories', ttl: 30_000 },
  ];

  // 3. Conditionally add user-specific preloads if we have the ID
  if (userId) {
    preloads.push({ 
      url: '/api/messages', 
cacheKey: `nous:messages:${userId}`,      ttl: 30_000 
    });
  }

  // 4. Run the fetches and save to device cache
  await Promise.allSettled(
    preloads.map(async ({ url, cacheKey, ttl }) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          writeDeviceCache(cacheKey, data, ttl);
        }
      } catch (err) {
        console.error(`Failed to warmup ${url}`, err);
      }
    })
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function SplashUI({ progress, fading }: { progress: number; fading: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-9999 flex flex-col items-center justify-center bg-background transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <img src="/animated_heart_icon.svg" alt="Loading" className="h-16 w-16" />
      <div className="mt-8 h-0.5 w-40 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface SplashScreenProps {
  loginUser?: User | null;
  onReady?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SplashScreen({ loginUser, onReady }: SplashScreenProps = {}) {
  // Grab the user from context to use during a boot-up reload
  const { isLoading, user } = useUser(); 
  const onReadyRef = useRef(onReady);
  
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // ── Post-login state ─────────────────────────────────────────────────────
  const [postVisible, setPostVisible] = useState(false);
  const [postFading, setPostFading]   = useState(false);
  const [postProgress, setPostProgress] = useState(0);

  useEffect(() => {
    if (!loginUser) return;

    setPostVisible(true);
    setPostFading(false);
    setPostProgress(0);

    const steps: [number, number][] = [[200, 25], [600, 55], [1200, 75], [2000, 88]];
    const timers = steps.map(([delay, target]) =>
      setTimeout(() => setPostProgress(target), delay)
    );

    // Pass the loginUser ID into the warmup!
    runWarmup(loginUser.id).finally(() => {
      timers.forEach(clearTimeout);
      setPostProgress(100);
      setTimeout(() => setPostFading(true), 400);
      setTimeout(() => {
        setPostVisible(false);
        onReadyRef.current?.();
      }, 900);
    });

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginUser]);

  // ── Boot state ───────────────────────────────────────────────────────────
  const [bootVisible, setBootVisible]   = useState(true);
  const [bootFading, setBootFading]     = useState(false);
  const [bootProgress, setBootProgress] = useState(0);
  const [bootWorkDone, setBootWorkDone] = useState(false);

const warmupRan = useRef(false);
useEffect(() => {
  if (warmupRan.current || loginUser || isLoading) return; // wait for user to load
  warmupRan.current = true;
  
  runWarmup(user?.id).then(() => setBootWorkDone(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isLoading]); // re-evaluate when loading state resolves

  const bootDone = !isLoading && bootWorkDone;

  useEffect(() => {
    if (loginUser) return; 
    const steps: [number, number][] = [[300, 30], [800, 60], [1600, 80], [2800, 88]];
    const timers = steps.map(([delay, target]) =>
      setTimeout(() => setBootProgress(target), delay)
    );
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bootDone || loginUser) return;
    setBootProgress(100);
    const t1 = setTimeout(() => setBootFading(true), 400);
    const t2 = setTimeout(() => setBootVisible(false), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [bootDone, loginUser]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loginUser) {
    if (!postVisible) return null;
    return <SplashUI progress={postProgress} fading={postFading} />;
  }

  if (!bootVisible) return null;
  return <SplashUI progress={bootProgress} fading={bootFading} />;
}