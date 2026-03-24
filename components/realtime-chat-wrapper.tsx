'use client';

import { useEffect, useMemo, useState } from 'react';
import { Phone } from 'lucide-react';
import { RealtimeChat } from '@/components/realtime-chat';
import { useCurrentUserImage } from '@/hooks/use-current-user-image';
import type { ChatMessage } from '@/hooks/use-realtime-chat';
import { createClient } from '@/lib/client';
import { readDeviceCache, writeDeviceCache } from '@/lib/device-cache';
import { Button } from '@/components/ui/button';
import { useCall } from '@/contexts/call';

interface RealtimeChatWrapperProps {
  currentUserId: string;
  currentUserName: string;
}

const DEVICE_MESSAGES_CACHE_TTL_MS = 45_000;

function hasOtherPeerInPresence(
  state: Record<string, unknown>,
  currentUserId: string
) {
  for (const [presenceKey, presences] of Object.entries(state)) {
    if (presenceKey === currentUserId) continue;

    if (Array.isArray(presences) && presences.length > 0) {
      const hasNonSelfMeta = presences.some((presence) => {
        if (!presence || typeof presence !== 'object') return false;
        const meta = presence as { userId?: string };
        return Boolean(meta.userId && meta.userId !== currentUserId);
      });

      if (hasNonSelfMeta || presenceKey !== currentUserId) {
        return true;
      }
    }
  }
  return false;
}

export function RealtimeChatWrapper({
  currentUserId,
  currentUserName,
}: RealtimeChatWrapperProps) {
  const { inviteAndStartCall } = useCall();
  const supabase = createClient();
  
  const roomName = 'default-chat-room';
  const deviceCacheKey = `nous:messages:${currentUserId}`;
  
  const [initialMessages, setInitialMessages] = useState<ChatMessage[]>(() => {
    const cached = readDeviceCache<ChatMessage[]>(deviceCacheKey);
    return cached ?? [];
  });
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const cached = readDeviceCache<ChatMessage[]>(deviceCacheKey);
    return !cached || cached.length === 0;
  });
  
  const [hasOtherPeerOnline, setHasOtherPeerOnline] = useState(false);
  const [isStartingCall, setIsStartingCall] = useState(false);
  const currentUserAvatarUrl = useCurrentUserImage();

  // Load messages
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/messages`, { cache: 'no-store' });
        if (!res.ok) return;
        
        const raw = await res.json();
        const formattedMessages = (Array.isArray(raw) ? raw : []).map((msg: any): ChatMessage => ({
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

        setInitialMessages(formattedMessages);
        writeDeviceCache(deviceCacheKey, formattedMessages, DEVICE_MESSAGES_CACHE_TTL_MS);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [deviceCacheKey]);

  // Presence channel
  useEffect(() => {
    const presenceChannel = supabase.channel(`presence:${roomName}`, {
      config: { presence: { key: currentUserId } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState() as Record<string, unknown>;
        setHasOtherPeerOnline(hasOtherPeerInPresence(state, currentUserId));
      })
      .on('presence', { event: 'join' }, () => {
        const state = presenceChannel.presenceState() as Record<string, unknown>;
        setHasOtherPeerOnline(hasOtherPeerInPresence(state, currentUserId));
      })
      .on('presence', { event: 'leave' }, () => {
        const state = presenceChannel.presenceState() as Record<string, unknown>;
        setHasOtherPeerOnline(hasOtherPeerInPresence(state, currentUserId));
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            userId: currentUserId,
            onlineAt: new Date().toISOString(),
          });
        } else {
          setHasOtherPeerOnline(false);
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [currentUserId, roomName, supabase]);

  const messagePool = liveMessages.length > 0 ? liveMessages : initialMessages;

  // Cache updater
  useEffect(() => {
    const latestMessages = liveMessages.length > 0 ? liveMessages : initialMessages;
    if (latestMessages.length > 0) {
      writeDeviceCache(deviceCacheKey, latestMessages, DEVICE_MESSAGES_CACHE_TTL_MS);
    }
  }, [deviceCacheKey, initialMessages, liveMessages]);

  // RESTORED: Deriving the peer from the message pool
  const peer = useMemo(() => {
    const newestPeerMessage = [...messagePool]
      .reverse()
      .find((message) => {
        const peerId = message.sender_id ?? message.user?.id;
        return Boolean(peerId && peerId !== currentUserId);
      });

    if (!newestPeerMessage) return null;

    const resolvedId = newestPeerMessage.sender_id ?? newestPeerMessage.user?.id;

    return {
      id: resolvedId as string,
      name: newestPeerMessage.user?.name || 'Unknown',
    };
  }, [messagePool, currentUserId]);

  const peerStatusLabel = hasOtherPeerOnline ? 'Online' : 'Offline';

  const handleStartCall = async () => {
    if (isStartingCall || !peer) return;

    setIsStartingCall(true);
    try {
      await inviteAndStartCall({
        partnerUserId: peer.id,
        partnerName: peer.name,
        baseRoomName: roomName,
      });
    } catch (error) {
      console.error('Failed to start call from header:', error);
    } finally {
      setIsStartingCall(false);
    }
  };
 
  if (isLoading) {
    return (
      <div className="mx-3 mt-1 flex h-full min-h-0 items-center justify-center rounded-3xl border border-border/70 bg-background/50 md:mx-6">
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
          <span>Loading messages...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-background">
      <div className="grid h-full gap-4 px-3 pb-3 md:gap-5 md:px-6 md:py-4">
        <div className="glass-panel flex h-full overflow-hidden min-h-0 flex-col rounded-3xl border border-border/70 p-3 md:p-4">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-6 h-24 w-24 rounded-full bg-primary/60 blur-2xl" />

          {/* RESTORED OLD HEADER BLOCK */}
          <div className="rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-foreground md:text-xl">
                  {peer ? peer.name : 'No peer yet'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground md:text-sm">{isStartingCall ? 'Preparing call...' : peerStatusLabel}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleStartCall}
                disabled={!peer || isStartingCall}
                title="Open voice call page"
              >
                {isStartingCall ? <img src="/animated_heart_icon.svg" alt="Loading" className="size-4" /> : <Phone className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="mt-3 min-h-0 rounded-2xl flex-1 overflow-hidden">
            <RealtimeChat
              roomName={roomName}
              username={currentUserName}
              currentUserId={currentUserId}
              userAvatarUrl={currentUserAvatarUrl}
              messages={messagePool}
              onMessage={setLiveMessages}
            />
          </div>
        </div>
      </div>
    </div>
  );
}