'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle, Music, Clapperboard } from 'lucide-react';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { useUnreadMessages } from '@/hooks/use-unread-messages';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'framer-motion';
import { useCurrentUserName } from '@/hooks/use-current-user-name';
import { useCurrentUserImage } from '@/hooks/use-current-user-image';

const NAV_ITEMS: { href: string; icon: React.ElementType; label: string; id?: string }[] = [
  { href: '/feed',     icon: Heart,         label: 'Moments' },
  { href: '/messages', icon: MessageCircle, label: 'Messages', id: 'messages' },
  { href: '/music',    icon: Music,         label: 'Media' },
  { href: '/cinema',   icon: Clapperboard,  label: 'Cinema' },
];

const PUBLIC_ROUTES = new Set(['/', '/login']);

function isPublicPath(pathname: string) {
  return PUBLIC_ROUTES.has(pathname) || pathname.startsWith('/auth');
}

export function Navigation() {
  const pathname = usePathname();
  const { hasUnread } = useUnreadMessages();
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const currentTheme = theme === 'system' ? systemTheme : theme;
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isNavigating, setIsNavigating] = React.useState(false);
  const navTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const userName = useCurrentUserName();
  const userImage = useCurrentUserImage();

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      ));
    };

    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(e => document.addEventListener(e, handleFullscreenChange));
    return () => events.forEach(e => document.removeEventListener(e, handleFullscreenChange));
  }, []);

  React.useEffect(() => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    setIsNavigating(false);
  }, [pathname]);

  React.useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
  }, []);

  const handleNavigateStart = React.useCallback((href: string) => {
    if (pathname === href || pathname.startsWith(`${href}/`)) return;
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
    navTimerRef.current = setTimeout(() => {
      setIsNavigating(true);
      navTimerRef.current = null;
    }, 120);
  }, [pathname]);

  if (isFullscreen || isPublicPath(pathname)) return null;

  return (
    <>
      {isNavigating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <img src="/animated_heart_icon.svg" alt="Navigating" className="h-10 w-10" />
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="glass-panel fixed left-4 top-4 z-30 hidden h-[calc(100vh-2rem)] w-64 flex-col overflow-hidden rounded-3xl p-4 md:flex">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-primary/40 blur-2xl" />

        <Link href="/feed" className="mb-8 px-2" aria-label="Go to feed">
          <Image src={mounted && currentTheme === 'dark' ? '/logoDark.svg' : '/logo.svg'} alt="Logo" width={48} height={48} className="h-10 w-auto" priority />
        </Link>

        <nav className="flex flex-1 flex-col gap-2" aria-label="Primary">
          {NAV_ITEMS.map(({ href, icon, label, id }) => (
            <NavAnchor
              key={href}
              href={href}
              icon={icon}
              label={label}
              active={pathname === href || pathname.startsWith(`${href}/`)}
              hasUnread={id === 'messages' ? hasUnread : false}
              variant="desktop"
              onNavigate={handleNavigateStart}
            />
          ))}
        </nav>

        <Link
          href="/account"
          className="mt-auto flex items-center gap-3 rounded-2xl border border-border/40 bg-background/40 p-3 transition-transform hover:bg-background/60 active:scale-95"
        >
          <CurrentUserAvatar size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="text-xs font-medium text-muted-foreground">Profile</p>
          </div>
        </Link>
      </aside>

      {/* Mobile Top Header */}
      <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 md:hidden">
        <div className="glass-panel flex h-14 items-center justify-between rounded-2xl px-4 shadow-lg shadow-black/5">
          <Image src={mounted && currentTheme === 'dark' ? '/logoDark.svg' : '/logo.svg'} alt="Nous logo" width={32} height={32} className="h-8 w-auto" priority />
          <Link href="/account" className="transition-transform active:scale-95">
            <CurrentUserAvatar size="md" />
          </Link>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 md:hidden">
        <div className="glass-panel grid grid-cols-4 gap-1 rounded-3xl p-2 shadow-xl shadow-black/10">
          {NAV_ITEMS.map(({ href, icon, label, id }) => (
            <NavAnchor
              key={href}
              href={href}
              icon={icon}
              label={label}
              active={pathname === href || pathname.startsWith(`${href}/`)}
              hasUnread={id === 'messages' ? hasUnread : false}
              variant="mobile"
              onNavigate={handleNavigateStart}
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
  onNavigate?: (href: string) => void;
}

const NavAnchor = React.memo(function NavAnchor({
  href, icon: Icon, label, active, hasUnread, variant, onNavigate,
}: NavAnchorProps) {
  const isMobile = variant === 'mobile';

  return (
    <Link href={href} onClick={() => onNavigate?.(href)} className="group relative block outline-none">
      <div
        className={`relative z-10 flex items-center justify-center gap-1 py-3 transition-colors duration-200 active:scale-95 [transition-property:color,background-color,transform] ${
          isMobile ? 'min-h-14 flex-col rounded-2xl' : 'flex-row justify-start rounded-xl px-4'
        } ${
          active
            ? 'text-primary-foreground'
            : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5'
        }`}
      >
        <div className="relative">
          <Icon className={`${isMobile ? 'h-6 w-6' : 'h-5 w-5'} transition-transform duration-200 group-hover:scale-110`} />
          {hasUnread && (
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${
              active ? 'border-primary bg-white' : 'border-white bg-primary dark:border-zinc-900'
            }`} />
          )}
        </div>

        <span className={isMobile ? 'text-[10px] font-bold uppercase tracking-wider' : 'ml-3 text-sm font-medium'}>
          {label}
        </span>

        <AnimatePresence>
          {active && (
            <motion.span
              layoutId={`activeNav-${variant}`}
              className={`absolute inset-0 -z-10 bg-primary shadow-md shadow-primary/20 ${
                isMobile ? 'rounded-2xl' : 'rounded-xl'
              }`}
              style={{ willChange: 'transform' }}
              transition={{ type: 'tween', ease: 'easeInOut', duration: 0.18 }}
            />
          )}
        </AnimatePresence>
      </div>
    </Link>
  );
});