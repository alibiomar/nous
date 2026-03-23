'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle, Music, Clapperboard } from 'lucide-react';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { useUnreadMessages } from '@/hooks/use-unread-messages';
import Image from 'next/image';

const NAV_ITEMS = [
  { href: '/feed',     icon: Heart,         label: 'Moments' },
  { href: '/messages', icon: MessageCircle, label: 'Messages', id: 'messages' },
  { href: '/music',    icon: Music,         label: 'Media' },
  { href: '/cinema',   icon: Clapperboard,  label: 'Cinema' },
];

export function Navigation() {
  const pathname = usePathname();
  const { hasUnread } = useUnreadMessages();
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isFull);
    };

    const events = [
      'fullscreenchange',
      'webkitfullscreenchange',
      'mozfullscreenchange',
      'MSFullscreenChange'
    ];

    events.forEach(event => document.addEventListener(event, handleFullscreenChange));

    return () => {
      events.forEach(event => document.removeEventListener(event, handleFullscreenChange));
    };
  }, []);

  const isActive = React.useCallback((path: string) => {
    return pathname === path || pathname.startsWith(`${path}/`);
  }, [pathname]);

  if (isFullscreen) return null;

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="glass-panel fixed left-4 top-4 z-30 hidden h-[calc(100vh-2rem)] w-64 flex-col rounded-3xl p-4 md:flex">
        <Link href="/feed" className="mb-8 px-2" aria-label="Go to feed">
          <Image src="/logo.svg" alt="Logo" width={48} height={48} className="h-10 w-auto" priority />
        </Link>

        <nav className="flex flex-1 flex-col gap-2" aria-label="Primary">
          {NAV_ITEMS.map(({ href, icon, label, id }) => (
            <NavAnchor
              key={`desktop-${href}`}
              href={href}
              icon={icon}
              label={label}
              active={isActive(href)}
              hasUnread={id === 'messages' ? hasUnread : false}
              variant="desktop"
            />
          ))}
        </nav>

        <Link
          href="/account"
          className="mt-auto flex items-center gap-3 rounded-2xl border border-border/40 bg-background/40 p-3 transition-transform hover:bg-background/60 active:scale-95"
        >
          <CurrentUserAvatar size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">You</p>
            <p className="text-xs font-medium text-muted-foreground">Profile</p>
          </div>
        </Link>
      </aside>

      {/* Mobile Top Header */}
      <header className="fixed inset-x-0 top-0 z-30 px-4 pt-4 md:hidden">
        <div className="glass-panel flex h-14 items-center justify-between rounded-2xl px-4 shadow-lg shadow-black/5">
          <Image src="/logo.svg" alt="Nous logo" width={32} height={32} className="h-8 w-auto" priority />
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
              key={`mobile-${href}`}
              href={href}
              icon={icon}
              label={label}
              active={isActive(href)}
              hasUnread={id === 'messages' ? hasUnread : false}
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

const NavAnchor = React.memo(function NavAnchor({ href, icon: Icon, label, active, hasUnread, variant }: NavAnchorProps) {
  const isMobile = variant === 'mobile';

  return (
    <Link href={href} className="group block outline-none">
      <div
        className={`flex items-center justify-center gap-1 py-3 transition-all duration-200 ease-in-out active:scale-95 ${
          isMobile ? 'min-h-14 flex-col rounded-2xl' : 'flex-row justify-start rounded-xl px-4'
        } ${
          active
            ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
            : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5'
        }`}
      >
        <div className="relative">
          <Icon className={`${isMobile ? 'h-6 w-6' : 'h-5 w-5'}`} />
          {hasUnread && (
            <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${
              active ? 'border-primary bg-white' : 'border-white bg-primary dark:border-zinc-900'
            }`} />
          )}
        </div>

        <span className={isMobile ? 'text-[10px] font-bold uppercase tracking-wider' : 'ml-3 text-sm font-medium'}>
          {label}
        </span>
      </div>
    </Link>
  );
});