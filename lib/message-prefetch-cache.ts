// lib/message-prefetch-cache.ts
// Module-level singleton — lives for the lifetime of the browser tab.
// Splash populates it; RealtimeChatWrapper reads it synchronously on mount
// so there's never a loading flash when navigating to /messages.

import type { ChatMessage } from '@/hooks/use-realtime-chat';

let _messages: ChatMessage[] | null = null;
let _promise: Promise<ChatMessage[]> | null = null;

export function getPreloadedMessages(): ChatMessage[] | null {
  return _messages;
}

export function setPreloadedMessages(messages: ChatMessage[]): void {
  _messages = messages;
}

export function clearPreloadedMessages(): void {
  _messages = null;
  _promise = null;
}

/** Called from Splash — fires one fetch and caches the result. */
export async function prefetchMessages(): Promise<void> {
  if (_messages !== null) return; // already populated
  if (_promise) { await _promise; return; }

  _promise = fetch('/api/messages?limit=200', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return [];
      const raw = await res.json();
      return (Array.isArray(raw) ? raw : []).map((msg: any): ChatMessage => ({
        id:        msg.id,
        sender_id: msg.sender_id,
        content:   msg.content,
        image_url: msg.image_url || null,
        user: {
          id:         msg.sender?.id,
          name:       msg.sender?.name || 'Unknown',
          avatar_url: msg.sender?.avatar_url || null,
        },
        createdAt: msg.created_at,
      }));
    })
    .catch(() => [] as ChatMessage[]);

  _messages = await _promise;
  _promise = null;
}
