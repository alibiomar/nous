'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle, Music, Clapperboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { useUnreadMessages } from '@/hooks/use-unread-messages';
import Image from 'next/image';

const NAV_ITEMS = [
  { href: '/feed',    icon: Heart,         label: 'Moments' },
  { href: '/messages', icon: MessageCircle, label: 'Messages', key: 'messages' },
  { href: '/music',    icon: Music,         label: 'Media' },
  { href: '/cinema',   icon: Clapperboard,  label: 'Cinema' },
];

export function Navigation() {
  const pathname = usePathname();
  const { hasUnread } = useUnreadMessages();

  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="glass-panel fixed left-4 top-4 z-30 hidden h-[calc(100vh-2rem)] w-64 flex-col rounded-3xl p-4 md:flex">
        <Link href="/feed" className="mb-8 px-2" aria-label="Go to feed">
          <Image src="/logo.svg" alt="Logo" width={48} height={48} className="h-10 w-auto" />
        </Link>

        <nav className="flex flex-1 flex-col gap-2" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavAnchor
              key={item.href}
              {...item}
              active={isActive(item.href)}
              hasUnread={item.key === 'messages' ? hasUnread : false}
              variant="desktop"
            />
          ))}
        </nav>

        <Link
          href="/account"
          className="mt-auto flex items-center gap-3 rounded-2xl border border-border/40 bg-background/40 p-3 transition-all hover:bg-background/60 active:scale-95"
        >
          <CurrentUserAvatar size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">You</p>
            <p className="text-xs text-muted-foreground font-medium">Profile</p>
          </div>
        </Link>
      </aside>

      {/* Mobile Top Header */}
      <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 md:hidden">
        <div className="glass-panel flex h-14 items-center justify-between rounded-2xl px-4 shadow-lg shadow-black/5">
          <Image src="/logo.svg" alt="Logo" width={32} height={32} />
          <Link href="/account" className="active:scale-90 transition-transform">
            <CurrentUserAvatar size="sm" />
          </Link>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 px-4 pb-6 md:hidden">
        <div className="glass-panel grid grid-cols-4 gap-1 rounded-4xl p-2 shadow-xl shadow-black/10">
          {NAV_ITEMS.map((item) => (
            <NavAnchor
              key={item.href}
              {...item}
              active={isActive(item.href)}
              hasUnread={item.key === 'messages' ? hasUnread : false}
              variant="mobile"
            />
          ))}
        </div>
      </nav>
    </>
  );
}

interface NavAnchorProps {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  hasUnread?: boolean;
  variant: 'desktop' | 'mobile';
}

function NavAnchor({ href, icon: Icon, label, active, hasUnread, variant }: NavAnchorProps) {
  const isMobile = variant === 'mobile';

  return (
    <Link href={href} className="relative group">
      <motion.div
        whileTap={{ scale: 0.92 }}
        className={`relative z-10 flex flex-col items-center justify-center gap-1 py-3 transition-colors duration-300 ${
          isMobile ? 'min-h-14 rounded-2xl' : 'flex-row justify-start px-4 rounded-xl'
        } ${active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <div className="relative">
          <Icon className={`${isMobile ? 'w-6 h-6' : 'w-5 h-5'} transition-transform group-hover:scale-110`} />
          {hasUnread && (
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${
              active ? 'bg-white border-primary' : 'bg-primary border-white dark:border-zinc-900'
            }`} />
          )}
        </div>
        
        <span className={isMobile ? 'text-[10px] font-bold uppercase tracking-wider' : 'text-sm font-medium ml-3'}>
          {label}
        </span>

        {/* Animated Background Pill */}
        {active && (
          <motion.div
            layoutId="activeNav"
            className="absolute inset-0 -z-10 bg-primary shadow-md shadow-primary/20"
            style={{ borderRadius: isMobile ? '1rem' : '0.75rem' }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />
        )}
      </motion.div>
    </Link>
  );
}