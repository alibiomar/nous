'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
  /** Seed the context from an external source (e.g. login response) without
   *  triggering a /api/auth/session round-trip. */
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const isPublicAuthRoute = pathname === '/login' || pathname.startsWith('/auth');

    // On public routes the login page handles its own warmup via SplashScreen.
    if (isPublicAuthRoute) {
      setIsLoading(false);
      return;
    }

const checkAuth = async () => {
  try {
    const response = await fetch('/api/auth/session');
    
    if (response.ok) {
      // Safely handle empty bodies to prevent JSON.parse errors
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      setUserState(data?.user || null);
    } else {
      setUserState(null);
    }
  } catch (err) {
    console.error('Failed to fetch session:', err);
    setUserState(null); // Ensure state resolves safely on failure
  } finally {
    setIsLoading(false);
  }
};

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setUser = useCallback((u: User) => {
    setUserState(u);
  }, []);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      setUserState(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('nous:call-session');
        clearAllDeviceCache();
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
    <UserContext.Provider value={{ user, isLoading, setUser, logout }}>
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