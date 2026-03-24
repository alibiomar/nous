'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { createClient } from '@/lib/client'

interface UseRealtimeChatProps {
  roomName: string
  username: string
  currentUserId: string
  userAvatarUrl?: string | null
  initialMessages?: ChatMessage[]
}

export interface ChatMessage {
  id: string
  sender_id?: string
  content: string | null
  image_url?: string | null
  is_edited?: boolean
  read?: boolean
  user: {
    id?: string
    name: string
    avatar_url?: string | null
  }
  createdAt: string
}

const EVENT_MESSAGE_TYPE = 'message'
const EVENT_EDIT_TYPE = 'message:edit'
const EVENT_DELETE_TYPE = 'message:delete'
const EVENT_UNREAD_INCREMENT_TYPE = 'unread:increment'
const EVENT_TYPING_TYPE = 'typing'
const EVENT_PEER_PRESENCE_TYPE = 'peer:presence'
const EVENT_CALL_INVITE_TYPE = 'call:invite'
const EVENT_CALL_INVITE_CLEAR_TYPE = 'call:invite:clear'

interface BroadcastPayload<T> {
  payload: T
}

interface SendMessagePayload {
  content: string | null
  imageUrl?: string | null
  id?: string         // <-- Add this
  createdAt?: string  // <-- Add this
}

interface PeerPresencePayload {
  userId: string
  username: string
  peerId: string
}

interface CallInvitePayload {
  roomName: string
  fromUserId: string
  fromUsername: string
  toUserId: string
}

interface UnreadIncrementPayload {
  recipientId: string
  delta?: number
}

export interface IncomingCallInvite {
  roomName: string
  fromUserId: string
  fromUsername: string
}

type BroadcastStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'

export function useRealtimeChat({ roomName, username, currentUserId, userAvatarUrl, initialMessages = [] }: UseRealtimeChatProps) {
  const supabase = useMemo(() => createClient(), [])
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [partnerIsTyping, setPartnerIsTyping] = useState(false)
  const [peerDirectory, setPeerDirectory] = useState<Record<string, string>>({})
  const [incomingCallInvite, setIncomingCallInvite] = useState<IncomingCallInvite | null>(null)

useEffect(() => {
  setMessages((current) => {
    const currentIds = new Set(current.map((m) => m.id))
    const toAdd = initialMessages.filter((m) => !currentIds.has(m.id))
    if (toAdd.length === 0) return current
    return [...toAdd, ...current]
  })
}, [initialMessages.length])

  useEffect(() => {
    const handleAddMessageEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ChatMessage>
      if (!customEvent.detail) return

      const incoming = customEvent.detail
      setMessages((current) => {
        // Already exists with real DB id — skip
        if (current.some((m) => m.id === incoming.id)) return current

        // Find a temp message from same sender with same content to replace
        // This gives instant UI feel while avoiding duplicates when DB id arrives
        const tempIndex = current.findLastIndex(
          (m) =>
            m.sender_id === incoming.sender_id &&
            m.content === incoming.content &&
            m.image_url === incoming.image_url &&
            // Temp messages use crypto.randomUUID() — real DB ids are also UUIDs
            // so we check if it's NOT already in the DB by seeing if no existing
            // message has this id as a real DB message (rough heuristic: temp msgs
            // were added optimistically and don't have a matching DB record yet)
            !current.some((other) => other.id === incoming.id)
        )

        if (tempIndex !== -1) {
          // Replace the temp message with the real one in-place
          const updated = [...current]
          updated[tempIndex] = incoming
          return updated
        }

        // No temp message found — just append
        return [...current, incoming]
      })
    }

    window.addEventListener('chat:add_message', handleAddMessageEvent)
    return () => {
      window.removeEventListener('chat:add_message', handleAddMessageEvent)
    }
  }, [])

  useEffect(() => {
    const newChannel = supabase.channel(roomName)

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload: BroadcastPayload<ChatMessage>) => {
        setMessages((current) => {
          const chatMsg = payload.payload as ChatMessage
          if (current.some((m) => m.id === chatMsg.id)) return current
          return [...current, chatMsg]
        })
      })
      .on('broadcast', { event: EVENT_EDIT_TYPE }, (payload: BroadcastPayload<{ messageId: string; content: string }>) => {
        const { messageId, content } = payload.payload
        setMessages((current) =>
          current.map((msg) =>
            msg.id === messageId
              ? { ...msg, content, is_edited: true }
              : msg
          )
        )
      })
      .on('broadcast', { event: EVENT_DELETE_TYPE }, (payload: BroadcastPayload<{ messageId: string }>) => {
        const { messageId } = payload.payload
        setMessages((current) => current.filter((msg) => msg.id !== messageId))
      })
      .on('broadcast', { event: EVENT_TYPING_TYPE }, (payload: BroadcastPayload<{ username: string; isTyping: boolean }>) => {
        if (payload.payload.username === username) {
          return
        }
        setPartnerIsTyping(Boolean(payload.payload.isTyping))
      })
      .on('broadcast', { event: EVENT_PEER_PRESENCE_TYPE }, (payload: BroadcastPayload<PeerPresencePayload>) => {
        const presence = payload.payload

        if (!presence?.userId || !presence?.peerId) {
          return
        }

        if (presence.userId === currentUserId) {
          return
        }

        setPeerDirectory((current) => {
          if (current[presence.userId] === presence.peerId) {
            return current
          }

          return {
            ...current,
            [presence.userId]: presence.peerId,
          }
        })
      })
      .on('broadcast', { event: EVENT_CALL_INVITE_TYPE }, (payload: BroadcastPayload<CallInvitePayload>) => {
        const invite = payload.payload

        if (!invite?.toUserId || invite.toUserId !== currentUserId) {
          return
        }

        setIncomingCallInvite({
          roomName: invite.roomName,
          fromUserId: invite.fromUserId,
          fromUsername: invite.fromUsername,
        })
      })
      .on('broadcast', { event: EVENT_CALL_INVITE_CLEAR_TYPE }, (payload: BroadcastPayload<{ toUserId: string }>) => {
        if (payload.payload?.toUserId === currentUserId) {
          setIncomingCallInvite(null)
        }
      })
      .subscribe(async (status: BroadcastStatus) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true)
        } else {
          setIsConnected(false)
        }
      })

    setChannel(newChannel)

    return () => {
      setPartnerIsTyping(false)
      supabase.removeChannel(newChannel)
    }
  }, [roomName, username, supabase])

  const sendMessage = useCallback(
    async ({ content, imageUrl, id, createdAt }: SendMessagePayload) => {
      if (!channel || !isConnected) return

      // Use the provided ID/timestamp from the UI, or generate new ones
      const messageId = id || crypto.randomUUID()
      const timestamp = createdAt || new Date().toISOString()

      const message: ChatMessage = {
        id: messageId,
        content,
        image_url: imageUrl,
        user: {
          id: currentUserId,
          name: username,
          avatar_url: userAvatarUrl,
        },
        createdAt: timestamp,
      }

      // Optimistically add to local state
      setMessages((current) => [...current, message])

      // Broadcast to other peers
      await channel.send({
        type: 'broadcast',
        event: EVENT_MESSAGE_TYPE,
        payload: message,
      })
    },
    [channel, isConnected, currentUserId, username, userAvatarUrl]
  )

  const broadcastEditMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!channel || !isConnected) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_EDIT_TYPE,
        payload: { messageId, content },
      })
    },
    [channel, isConnected]
  )

  const broadcastDeleteMessage = useCallback(
    async (messageId: string) => {
      if (!channel || !isConnected) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_DELETE_TYPE,
        payload: { messageId },
      })
    },
    [channel, isConnected]
  )

  const broadcastUnreadIncrement = useCallback(
    async ({ recipientId, delta = 1 }: UnreadIncrementPayload) => {
      if (!supabase || !recipientId) return

      // Create a temporary channel to broadcast directly to the recipient's personal notification listener
      const channelName = `user-notifications-${recipientId}`
      const notifChannel = supabase.channel(channelName)
      
      // If already connected (e.g. sending to ourselves in some test), just send
      if (notifChannel.state === 'joined') {
        await notifChannel.send({
          type: 'broadcast',
          event: EVENT_UNREAD_INCREMENT_TYPE,
          payload: { recipientId, delta },
        })
        return
      }

      return new Promise<void>((resolve) => {
        let isCleaningUp = false
        notifChannel.subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await notifChannel.send({
              type: 'broadcast',
              event: EVENT_UNREAD_INCREMENT_TYPE,
              payload: { recipientId, delta },
            })
            // Clean up to prevent having too many open channels if we message many different people
            if (!isCleaningUp && recipientId !== currentUserId) {
              isCleaningUp = true
              supabase.removeChannel(notifChannel)
            }
            resolve()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            if (!isCleaningUp && recipientId !== currentUserId) {
              isCleaningUp = true
              supabase.removeChannel(notifChannel)
            }
            resolve()
          } else if (status === 'CLOSED') {
            // Do NOT call removeChannel here; calling it triggers 'CLOSED' recursively!
            resolve()
          }
        })
      })
    },
    [supabase, currentUserId]
  )

  const broadcastTypingStatus = useCallback(
    async (isTyping: boolean) => {
      if (!channel || !isConnected) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_TYPING_TYPE,
        payload: { username, isTyping },
      })
    },
    [channel, isConnected, username]
  )

  const broadcastPeerPresence = useCallback(
    async (peerId: string) => {
      if (!channel || !isConnected || !peerId) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_PEER_PRESENCE_TYPE,
        payload: {
          userId: currentUserId,
          username,
          peerId,
        },
      })
    },
    [channel, isConnected, currentUserId, username]
  )

  const broadcastCallInvite = useCallback(
    async ({ roomName, toUserId }: { roomName: string; toUserId: string }) => {
      if (!channel || !isConnected || !roomName || !toUserId) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_CALL_INVITE_TYPE,
        payload: {
          roomName,
          fromUserId: currentUserId,
          fromUsername: username,
          toUserId,
        },
      })
    },
    [channel, isConnected, currentUserId, username]
  )

  const clearIncomingCallInvite = useCallback(
    async (toUserId?: string) => {
      setIncomingCallInvite(null)

      if (!channel || !isConnected || !toUserId) return

      await channel.send({
        type: 'broadcast',
        event: EVENT_CALL_INVITE_CLEAR_TYPE,
        payload: { toUserId },
      })
    },
    [channel, isConnected]
  )

  const updateMessageLocally = useCallback(
    (messageId: string, updates: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((msg) =>
          msg.id === messageId
            ? { ...msg, ...updates }
            : msg
        )
      )
    },
    []
  )

  const deleteMessageLocally = useCallback(
    (messageId: string) => {
      setMessages((current) => current.filter((msg) => msg.id !== messageId))
    },
    []
  )

  return { 
    messages, 
    sendMessage, 
    isConnected, 
    partnerIsTyping,
    peerDirectory,
    incomingCallInvite,
    broadcastEditMessage, 
    broadcastDeleteMessage,
    broadcastUnreadIncrement,
    broadcastTypingStatus,
    broadcastPeerPresence,
    broadcastCallInvite,
    clearIncomingCallInvite,
    updateMessageLocally,
    deleteMessageLocally,
  }
}