"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RealtimeChatWrapper } from "@/components/realtime-chat-wrapper";
import { useUser } from "@/contexts/user";
import { useUnreadMessages } from "@/hooks/use-unread-messages";

export default function MessagesPage() {
  const router = useRouter();
  const { user, isLoading } = useUser();
  const { hasUnread, clearUnread } = useUnreadMessages();

  // Mark messages as read when user visits this page (non-blocking)
  useEffect(() => {
    if (!user?.id) return;
    if (!hasUnread) return;

    fetch("/api/messages/read", { method: "PUT" })
      .then((response) => {
        if (response.ok) {
          clearUnread();
          window.dispatchEvent(new Event("messages:read"));
        }
      })
      .catch(() => {
        // Silent - don't block rendering
      });
  }, [user?.id, hasUnread, clearUnread]);

  // If there's no session, redirect to login (after initial loading)
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (!user) {
    return (
      <div className="mx-3 mt-1 flex h-full min-h-[60vh] items-center justify-center rounded-3xl border border-border/70 bg-background/50 md:mx-6">
        <p className="text-muted-foreground">Redirecting to login...</p>
      </div>
    );
  }

  return <RealtimeChatWrapper currentUserId={user.id} currentUserName={user.name} />;
}
