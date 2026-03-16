'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RealtimeChatWrapper } from '@/components/realtime-chat-wrapper';
import { useUser, type User } from '@/contexts/user';

export default function MessagesPage() {
  const router = useRouter();
  const { user, isLoading } = useUser();
  const [fallbackUser, setFallbackUser] = useState<User | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(false);

  useEffect(() => {
    if (isLoading || user) {
      return;
    }

    const loadSessionDirectly = async () => {
      setIsCheckingSession(true);
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const data = await response.json();
          setFallbackUser(data.user ?? null);
          return;
        }
      } catch (error) {
        console.error('Failed to restore session on messages page:', error);
      } finally {
        setIsCheckingSession(false);
      }

      router.replace('/login');
    };

    loadSessionDirectly();
  }, [isLoading, user, router]);

  // Mark messages as read when user visits this page (non-blocking)
  useEffect(() => {
    const activeUser = user ?? fallbackUser;
    if (activeUser?.id) {
      fetch('/api/messages/read', { method: 'PUT' })
        .then((response) => {
          if (response.ok) {
            window.dispatchEvent(new Event('messages:read'));
          }
        })
        .catch(() => {
          // Silent - don't block rendering
        });
    }
  }, [user?.id, fallbackUser?.id]);

  const activeUser = user ?? fallbackUser;

  if (isLoading || isCheckingSession) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!activeUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Redirecting to login...</p>
      </div>
    );
  }

  return <RealtimeChatWrapper currentUserId={activeUser.id} currentUserName={activeUser.name} />;
}
