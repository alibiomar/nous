'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, MessageCircle, Music, LogOut, Sparkles, User, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { useUnreadMessages } from '@/hooks/use-unread-messages';

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  const { hasUnread } = useUnreadMessages();

  const isActive = (path: string) => pathname === path;

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const navItems = [
    { href: '/feed', icon: <Heart className="w-5 h-5" />, label: 'Feed' },
    { href: '/messages', icon: <MessageCircle className="w-5 h-5" />, label: 'Messages', hasUnread },
    { href: '/music', icon: <Music className="w-5 h-5" />, label: 'Media' },
  ];

  return (
    <>
      {/* Desktop Sidebar - Collapsible Design */}
      <nav className={`hidden md:fixed md:left-0 md:top-0 md:h-screen md:flex md:flex-col md:border-r md:border-border md:bg-card md:transition-all md:duration-300 ${
        desktopCollapsed ? 'md:w-20' : 'md:w-72'
      }`}>
        
        {/* Header with Collapse Button */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          {!desktopCollapsed && (
            <Link href="/feed" className="flex items-center gap-2 flex-1">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span className="font-serif text-xl font-semibold text-foreground hidden lg:inline">Nous</span>
            </Link>
          )}
          <button
            onClick={() => setDesktopCollapsed(!desktopCollapsed)}
            className="p-1.5 hover:bg-secondary rounded-lg transition-colors ml-auto"
            title={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft className={`w-5 h-5 transition-transform ${desktopCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* User Profile Card */}
        <div className={`${desktopCollapsed ? 'px-2 py-4' : 'px-6 py-4'} border-b border-border`}>
          <Link 
            href="/account" 
            className={`flex items-center gap-3 transition-all ${
              desktopCollapsed ? 'justify-center' : ''
            }`}
            title="Go to profile"
          >
            <CurrentUserAvatar size="md" />
            {!desktopCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">You</p>
                <p className="text-xs text-muted-foreground">Profile</p>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation Links */}
        <div className={`flex-1 ${desktopCollapsed ? 'px-2 py-4' : 'px-4 py-6'} space-y-2`}>
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
              collapsed={desktopCollapsed}
              hasUnread={item.hasUnread}
            />
          ))}
        </div>

        {/* Logout Button */}
        <div className={`${desktopCollapsed ? 'px-2 pb-4' : 'px-4 pb-6'} border-t border-border pt-4`}>
          <Button
            onClick={handleLogout}
            variant="outline"
            className={`w-full transition-all gap-2 ${desktopCollapsed ? 'p-0' : ''}`}
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            {!desktopCollapsed && 'Logout'}
          </Button>
        </div>
      </nav>

      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 border-b border-border bg-card flex items-center justify-between px-4 z-40">
        <Link href="/feed" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-serif text-lg font-semibold text-foreground">Nous</span>
        </Link>
        <Link href="/account" className="inline-flex items-center" title="Go to account">
          <CurrentUserAvatar size="sm" />
        </Link>
      </div>

      {/* Mobile Bottom Tab Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/85">
        <div className="grid grid-cols-4 gap-1 px-2 py-2">
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
            className="flex min-h-14 flex-col items-center justify-center rounded-lg px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Logout"
            title="Logout"
            type="button"
          >
            <LogOut className="h-5 w-5" />
            <span className="mt-1 text-[11px] leading-none">Logout</span>
          </button>
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
  collapsed?: boolean;
  hasUnread?: boolean;
}

function NavLink({ href, icon, label, active, collapsed, hasUnread }: NavLinkProps) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 relative group ${
        active
          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
          : 'text-foreground hover:bg-secondary'
      }`}
    >
      <span className="shrink-0 relative inline-block">
        {icon}
        {hasUnread && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full block border border-card"></span>
        )}
      </span>
      {!collapsed && <span className="flex-1">{label}</span>}
      
      {/* Tooltip for collapsed state */}
      {collapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-secondary text-foreground text-sm rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
          {label}
        </div>
      )}
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
      className={`flex min-h-14 flex-col items-center justify-center rounded-lg px-1 transition-all duration-200 relative ${
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <span className="shrink-0 relative inline-block">
        {icon}
        {hasUnread && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full block border border-card"></span>
        )}
      </span>
      <span className="mt-1 text-[11px] leading-none">{label}</span>
    </Link>
  );
}
