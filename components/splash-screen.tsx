'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/contexts/user';

export function SplashScreen() {
  const { isLoading } = useUser();
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  // Simulate progress while loading — eases to ~90% then waits for real auth
  useEffect(() => {
    if (!isLoading) return;

    const steps: [number, number][] = [
      [300,  30],
      [800,  60],
      [1600, 80],
      [2800, 90],
    ];

    const timers = steps.map(([delay, target]) =>
      setTimeout(() => setProgress(target), delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  // Auth resolved → jump to 100%, then fade out
  useEffect(() => {
    if (!isLoading) {
      setProgress(100);
      const t = setTimeout(() => setVisible(false), 900);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background transition-opacity duration-500 ${
        isLoading ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <img
        src="/animated_heart_icon.svg"
        alt="Loading"
        className="h-16 w-16"
      />

      {/* Progress bar */}
      <div className="mt-8 h-0.5 w-40 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}