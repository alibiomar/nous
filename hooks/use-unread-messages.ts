'use client';

import { useUnreadMessagesContext } from '@/contexts/unread-messages';

export function useUnreadMessages() {
  const { unreadCount, hasUnread, refreshUnread, clearUnread } = useUnreadMessagesContext();
  return { unreadCount, hasUnread, refreshUnread, clearUnread };
}
