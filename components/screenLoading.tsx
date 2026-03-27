'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const COLORS = [
  '#ff4d4d', '#22c55e', '#3b82f6',
  '#eab308', '#a855f7', '#f97316', '#14b8a6',
];
const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// Badge approximate size — used to keep it fully inside the container
const BADGE_W = 72;
const BADGE_H = 36;

export function CinemaPlayerSkeleton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const [state, setState] = useState({
    x: 0, y: 0,
    vx: 2, vy: 2,
    color: 'rgba(255,255,255,0.1)',
  });

  // Track container size via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        const maxX = sizeRef.current.w - BADGE_W;
        const maxY = sizeRef.current.h - BADGE_H;

        // Container not measured yet — stay put
        if (maxX <= 0 || maxY <= 0) return prev;

        let { vx, vy, color } = prev;
        let newX = prev.x + vx;
        let newY = prev.y + vy;

        if (newX <= 0 || newX >= maxX) { vx *= -1; color = randomColor(); newX = Math.max(0, Math.min(maxX, newX)); }
        if (newY <= 0 || newY >= maxY) { vy *= -1; color = randomColor(); newY = Math.max(0, Math.min(maxY, newY)); }

        return { x: newX, y: newY, vx, vy, color };
      });
    }, 16);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-64 bg-black/40 rounded-xl overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-[shimmer_1.8s_infinite]" />

      <motion.div
        className="absolute px-2 py-1 border"
        style={{ backgroundColor: state.color, borderColor: state.color }}
        animate={{ x: state.x, y: state.y }}
        transition={{ type: 'tween', ease: 'linear', duration: 0.016 }}
      >
        <img src="/DVD.svg" alt="DVD logo" className="w-auto h-6 inline-block " />
      </motion.div>
    </div>
  );
}