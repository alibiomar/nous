'use client';

import { useEffect, useState } from 'react';
import { RealtimeChat } from '@/components/realtime-chat';
import { useCurrentUserImage } from '@/hooks/use-current-user-image';
import type { ChatMessage } from '@/hooks/use-realtime-chat';

interface RealtimeChatWrapperProps {
  currentUserId: string;
  currentUserName: string;
}

export function RealtimeChatWrapper({
  currentUserId,
  currentUserName,
}: RealtimeChatWrapperProps) {
  const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const currentUserAvatarUrl = useCurrentUserImage();

  // Fetch initial message history from database
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch('/api/messages');
        if (response.ok) {
          const messages = await response.json();
          // Transform to ChatMessage format
          const transformedMessages: ChatMessage[] = messages.map((msg: any) => ({
            id: msg.id,
            sender_id: msg.sender_id,
            content: msg.content,
            image_url: msg.image_url || null,
            user: {
              id: msg.sender?.id,
              name: msg.sender?.name || 'Unknown',
              avatar_url: msg.sender?.avatar_url || null,
            },
            createdAt: msg.created_at,
          }));
          setInitialMessages(transformedMessages);
        }
      } catch (error) {
        console.error('Failed to load initial messages:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, []);
 
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-sm text-text-secondary">Loading messages...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Chat Header */}
      <div className="px-4 md:px-6 py-4 border-b border-border">
        <h1 className="text-xl md:text-2xl font-serif font-semibold text-foreground">Messages</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Real-time conversation</p>
      </div>
      
      {/* Chat Content */}
      <div className="flex-1 overflow-hidden">
        <RealtimeChat
          roomName="default-chat-room"
          username={currentUserName}
          currentUserId={currentUserId}
          userAvatarUrl={currentUserAvatarUrl}
          messages={initialMessages}
         />
      </div>
    </div>
  );
}
