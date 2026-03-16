'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@/contexts/user';
import { createClient } from '@/lib/client';

const CHAT_ROOM_NAME = 'chat_default-chat-room';
const EVENT_UNREAD_INCREMENT_TYPE = 'unread:increment';

interface MessageChangeRecord {
  read?: boolean | null;
}

interface MessageChangePayload {
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  new?: MessageChangeRecord;
  old?: MessageChangeRecord;
}

interface UnreadIncrementPayload {
  recipientId?: string;
  delta?: number;
}

interface UnreadMessagesContextType {
  unreadCount: number;
  hasUnread: boolean;
  refreshUnread: () => Promise<void>;
  clearUnread: () => void;
}

const UnreadMessagesContext = createContext<UnreadMessagesContextType | undefined>(undefined);

export function UnreadMessagesProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasUnread, setHasUnread] = useState(false);
  const isBootstrappedRef = useRef(false);

  const applyUnreadCount = useCallback((nextCount: number) => {
    const safeCount = Math.max(0, nextCount);
    setUnreadCount(safeCount);
    setHasUnread(safeCount > 0);
  }, []);

  const bumpUnread = useCallback((delta: number) => {
    setUnreadCount((current) => {
      const next = Math.max(0, current + delta);
      setHasUnread(next > 0);
      return next;
    });
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!user?.id) {
      applyUnreadCount(0);
      return;
    }

    try {
      const response = await fetch('/api/messages/unread-count', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        applyUnreadCount(0);
        return;
      }

      const data = await response.json();
      const nextCount = Number(data?.unreadCount ?? 0);
      applyUnreadCount(nextCount);
      isBootstrappedRef.current = true;
    } catch {
      applyUnreadCount(0);
    }
  }, [applyUnreadCount, user?.id]);

  const clearUnread = useCallback(() => {
    applyUnreadCount(0);
  }, [applyUnreadCount]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!user?.id) {
      isBootstrappedRef.current = false;
      clearUnread();
      return;
    }

    let isMounted = true;
    const supabase = createClient();

    const safeRefresh = async () => {
      if (!isMounted) return;
      await refreshUnread();
    };

    // Initial read once per user session.
    safeRefresh();

    const dbChannel = supabase
      .channel(`unread-messages-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload: MessageChangePayload) => {
          if (!isBootstrappedRef.current) {
            safeRefresh();
            return;
          }

          const oldRead = Boolean(payload.old?.read);
          const newRead = Boolean(payload.new?.read);

          if (!oldRead && newRead) {
            bumpUnread(-1);
            return;
          }

          if (oldRead && !newRead) {
            bumpUnread(1);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload: MessageChangePayload) => {
          if (!isBootstrappedRef.current) {
            safeRefresh();
            return;
          }

          const deletedWasUnread = !Boolean(payload.old?.read);
          if (deletedWasUnread) {
            bumpUnread(-1);
          }
        }
      )
      .subscribe();

    const unreadSignalChannel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'broadcast',
        { event: EVENT_UNREAD_INCREMENT_TYPE },
        (message: { payload: UnreadIncrementPayload }) => {
          if (!isBootstrappedRef.current) {
            safeRefresh();
            return;
          }

          if (message.payload?.recipientId !== user.id) {
            return;
          }

          const delta = Number(message.payload?.delta ?? 1);
          if (!Number.isFinite(delta) || delta === 0) {
            return;
          }

          bumpUnread(delta);
        }
      )
      .subscribe();

    const onMessagesRead = () => {
      clearUnread();
    };

    window.addEventListener('messages:read', onMessagesRead);

    return () => {
      isMounted = false;
      window.removeEventListener('messages:read', onMessagesRead);
      supabase.removeChannel(dbChannel);
      supabase.removeChannel(unreadSignalChannel);
    };
  }, [user?.id, isLoading, refreshUnread, clearUnread, bumpUnread]);

  const value = useMemo(
    () => ({
      unreadCount,
      hasUnread,
      refreshUnread,
      clearUnread,
    }),
    [unreadCount, hasUnread, refreshUnread, clearUnread]
  );

  return <UnreadMessagesContext.Provider value={value}>{children}</UnreadMessagesContext.Provider>;
}

export function useUnreadMessagesContext() {
  const context = useContext(UnreadMessagesContext);
  if (context === undefined) {
    throw new Error('useUnreadMessagesContext must be used within UnreadMessagesProvider');
  }
  return context;
}
