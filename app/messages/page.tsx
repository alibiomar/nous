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
      <div className="mx-3 mt-1 flex h-full min-h-[60vh] items-center justify-center rounded-3xl border border-border/70 bg-background/50 md:mx-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
          <span>Loading messages...</span>
        </div>      </div>
    );
  }

  if (!activeUser) {
    return (
      <div className="mx-3 mt-1 flex h-full min-h-[60vh] items-center justify-center rounded-3xl border border-border/70 bg-background/50 md:mx-6">
        <p className="text-muted-foreground">Redirecting to login...</p>
      </div>
    );
  }

  return <RealtimeChatWrapper currentUserId={activeUser.id} currentUserName={activeUser.name} />;
}
