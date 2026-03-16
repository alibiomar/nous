'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle, Music, LogOut, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { useUnreadMessages } from '@/hooks/use-unread-messages';
import Image from 'next/image';
export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const { hasUnread } = useUnreadMessages();

  const isActive = (path: string) => pathname === path;

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setIsLoggingOut(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      window.dispatchEvent(new Event('messages:read'));
      sessionStorage.removeItem('nous:call-session');
      router.replace('/login');
      router.refresh();
      setIsLoggingOut(false);
    }
  };

  const navItems = [
    { href: '/feed', icon: <Heart className="w-5 h-5" />, label: 'Moments' },
    { href: '/messages', icon: <MessageCircle className="w-5 h-5" />, label: 'Messages', hasUnread },
    { href: '/music', icon: <Music className="w-5 h-5" />, label: 'Media' },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="glass-panel fixed left-4 top-4 z-30 hidden h-[calc(100vh-2rem)] w-68 flex-col rounded-3xl p-4 md:flex">
        <Link href="/feed" className="flex items-center gap-3 rounded-2xl px-2 py-1" aria-label="Go to feed">
          <Image src="/logo.svg" alt="Nous logo" width={64} height={64} className="h-12 w-auto" />
        </Link>

        <Link
          href="/account"
          className="mt-5 flex items-center gap-3 rounded-2xl border border-border/70 bg-background/50 px-3 py-3 transition-colors hover:bg-background/70"
          title="Go to account"
        >
          <CurrentUserAvatar size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">You</p>
            <p className="text-xs text-muted-foreground">Profile</p>
          </div>
        </Link>

        <nav className="mt-6 flex flex-1 flex-col gap-2" aria-label="Primary">
          {navItems.map((item) => (
            <DesktopSidebarLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              hasUnread={item.hasUnread}
            />
          ))}
        </nav>

        <Button
          onClick={handleLogout}
          variant="outline"
          disabled={isLoggingOut}
          className="mt-auto h-11 rounded-2xl hover:text-primary cursor-pointer border-border/70 bg-background/60 hover:bg-background/80"
          title="Logout"
        >
          <LogOut className="mr-2 h-4 w-4 " />
          {isLoggingOut ? 'Logging out...' : 'Logout'}
        </Button>
      </aside>

      {/* Mobile Top Header */}
      <header className="fixed inset-x-0 top-0 z-50 md:hidden">
        <div className="px-3 pt-3">
          <div className="glass-panel flex h-14 items-center justify-between rounded-2xl px-3">
            <Link href="/feed" className="flex items-center gap-2" aria-label="Go to feed">
              <Image src="/icon.svg" alt="Nous logo" width={32} height={32} className="h-8 w-auto" />
            </Link>
            <Link href="/account" className="inline-flex items-center" title="Go to account">
              <CurrentUserAvatar size="sm" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Tab Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-50 md:hidden">
        <div className="px-3 pb-3">
          <div className="glass-panel grid grid-cols-4 gap-1 rounded-2xl px-2 py-2">
            {navItems.map((item) => (
              <MobileTabLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={isActive(item.href)}
                hasUnread={item.hasUnread}
              />
            ))}
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex min-h-14 flex-col items-center justify-center rounded-xl px-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
              aria-label="Logout"
              title="Logout"
              type="button"
            >
              <LogOut className="h-5 w-5" />
              <span className="mt-1 text-[11px] leading-none">Logout</span>
            </button>
          </div>
        </div>
      </nav>

    </>
  );
}

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasUnread?: boolean;
}

function DesktopSidebarLink({ href, icon, label, active, hasUnread }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-all ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-foreground hover:bg-background/65'
      }`}
    >
      <span className="relative inline-block shrink-0">
        {icon}
        {hasUnread && (
          <span className="absolute -right-1 -top-1 block h-2.5 w-2.5 rounded-full bg-primary"></span>
        )}
      </span>
      <span>{label}</span>
    </Link>
  );
}

interface MobileTabLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasUnread?: boolean;
}

function MobileTabLink({ href, icon, label, active, hasUnread }: MobileTabLinkProps) {
  return (
    <Link
      href={href}
      className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl px-1 transition-all duration-200 ${
        active
          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
      }`}
    >
      <span className="relative inline-block shrink-0">
        {icon}
        {hasUnread && (
          <span className="absolute -right-1 -top-1 block h-2.5 w-2.5 rounded-full bg-primary"></span>
        )}
      </span>
      <span className="mt-1 text-[11px] leading-none">{label}</span>
    </Link>
  );
}
