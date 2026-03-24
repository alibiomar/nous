'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { clearAllDeviceCache } from '@/lib/device-cache';
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  birthday: string | null;
}

interface UserContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isPublicAuthRoute = pathname === '/login' || pathname.startsWith('/auth');

    // If we're on a public route, no need to fetch session.
    if (isPublicAuthRoute) {
      setIsLoading(false);
      return;
    }

    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);

          // --- WARMUP LOGIC ---
          const promises: Promise<unknown>[] = [];
          
          // Pre-fetch stories
          promises.push(fetch('/api/stories', { cache: 'no-store' }).catch(() => null));
          
          if (data.user) {
            // Pre-fetch unread count
            promises.push(fetch('/api/messages/unread-count', { cache: 'no-store' }).catch(() => null));
          }
          
          // Safely execute DOM-dependent preloading
          if (typeof window !== 'undefined') {
            // Preload core image assets
            for (const src of ['/logo.svg', '/animated_heart_icon.svg']) {
              const img = new Image();
              img.src = src;
            }
            
            // Warm up YouTube API script
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
              const s = document.createElement('script');
              s.src = 'https://www.youtube.com/iframe_api';
              s.async = true;
              document.head.appendChild(s);
            }
          }

          // Execute background fetches without blocking the UI
          Promise.allSettled(promises);
          // --------------------

          return;
        }

        setUser(null);
      } catch (err) {
        console.error('Failed to fetch session:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // Run only once on mount to avoid re-checking on every navigation.
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      setUser(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('nous:call-session');
        clearAllDeviceCache(); // <--- Safely deletes all messages, feeds, and private data
      }
      router.replace('/login');
      router.refresh();
    } catch (err) {
      console.error('Logout failed:', err);
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <UserContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
}