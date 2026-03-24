'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

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
      sessionStorage.removeItem('nous:call-session');
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
