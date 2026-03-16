'use client'

import { Image as ImageIcon, Loader2, Phone, Send, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { ChatMessageItem } from '@/components/chat-message'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import {
  useRealtimeChat,
  type ChatMessage,
} from '@/hooks/use-realtime-chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCall } from '@/contexts/call'

interface RealtimeChatProps {
  roomName: string
  username: string
  currentUserId: string
  userAvatarUrl?: string | null
  onMessage?: (messages: ChatMessage[]) => void
  messages?: ChatMessage[]
}

/**
 * Realtime chat component
 * @param roomName - The name of the room to join. Each room is a unique chat.
 * @param username - The username of the user
 * @param onMessage - The callback function to handle the messages. Useful if you want to store the messages in a database.
 * @param messages - The messages to display in the chat. Useful if you want to display messages from a database.
 * @returns The chat component
 */
export const RealtimeChat = ({
  roomName,
  username,
  currentUserId,
  userAvatarUrl,
  onMessage,
  messages: initialMessages = [],
}: RealtimeChatProps) => {
  const { inviteAndStartCall } = useCall()
  const { containerRef, sentinelRef, scrollToBottom, scrollToBottomIfAtBottom } = useChatScroll()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userTypingRef = useRef(false)
  const initialScrolledRef = useRef(false)
  const hasScrolledOnceRef = useRef(false)

  const {
    messages: realtimeMessages,
    sendMessage,
    isConnected,
    partnerIsTyping,
    broadcastEditMessage,
    broadcastDeleteMessage,
    broadcastUnreadIncrement,
    broadcastTypingStatus,
    updateMessageLocally,
    deleteMessageLocally,
  } = useRealtimeChat({
    roomName,
    username,
    currentUserId,
    userAvatarUrl,
    initialMessages,
  })
  const [newMessage, setNewMessage] = useState('')
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [isStartingCall, setIsStartingCall] = useState(false)

  const getMessageTimestamp = useCallback((message: ChatMessage) => {
    const rawTimestamp = message.createdAt ?? (message as { created_at?: string | null }).created_at ?? null
    const parsedTimestamp = rawTimestamp ? Date.parse(rawTimestamp) : Number.NaN

    return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp
  }, [])

  // Merge realtime messages with initial messages
  const allMessages = useMemo(() => {
    // realtimeMessages already includes initialMessages + realtime updates
    const normalizedMessages = realtimeMessages.map((message) => ({
      ...message,
      user: {
        id: message.user?.id ?? message.sender_id,
        name: message.user?.name?.trim() || 'Unknown user',
        avatar_url: message.user?.avatar_url ?? null,
      },
    }))

    const sortedMessages = [...normalizedMessages].sort((a, b) => {
      return getMessageTimestamp(a) - getMessageTimestamp(b)
    })
    return sortedMessages
  }, [getMessageTimestamp, realtimeMessages])

  const callPartner = useMemo(() => {
    const newestPartnerMessage = [...allMessages]
      .reverse()
      .find((message) => {
        const senderId = message.sender_id ?? message.user?.id
        return Boolean(senderId && senderId !== currentUserId)
      })

    if (!newestPartnerMessage) {
      return null
    }

    const userId = newestPartnerMessage.sender_id ?? newestPartnerMessage.user?.id
    if (!userId) {
      return null
    }

    return {
      userId,
      name: newestPartnerMessage.user?.name || 'Unknown user',
    }
  }, [allMessages, currentUserId])

  const handleStartCall = useCallback(async () => {
    if (!callPartner || !isConnected || isStartingCall) {
      return
    }

    setIsStartingCall(true)

    try {
      await inviteAndStartCall({
        partnerUserId: callPartner.userId,
        partnerName: callPartner.name,
        baseRoomName: roomName,
      })
    } catch (error) {
      console.error('Failed to start call invitation:', error)
      setIsStartingCall(false)
    }
  }, [callPartner, inviteAndStartCall, isConnected, isStartingCall, roomName])

  useEffect(() => {
    if (onMessage) {
      onMessage(allMessages)
    }
  }, [allMessages, onMessage])

  // Initial scroll - instant to avoid visible jump
  useLayoutEffect(() => {
    if (initialScrolledRef.current) return
    if (allMessages.length === 0) return

    initialScrolledRef.current = true
    hasScrolledOnceRef.current = true

    // Scroll immediately without animation
    scrollToBottom('auto')
    
    // Secondary scroll after DOM paints in case of image loading/layout shifts
    const raf = requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
    
    const timeout = setTimeout(() => {
      scrollToBottom('auto')
    }, 100)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timeout)
    }
  }, [allMessages.length, scrollToBottom])

  // Smooth scroll when new messages arrive (only if user is at bottom)
  useEffect(() => {
    if (!hasScrolledOnceRef.current) return // Skip until initial scroll done
    if (allMessages.length === 0) return

    scrollToBottomIfAtBottom('smooth')
  }, [allMessages.length, scrollToBottomIfAtBottom])

  useEffect(() => {
    if (!partnerIsTyping) return
    scrollToBottomIfAtBottom('smooth')
  }, [partnerIsTyping, scrollToBottomIfAtBottom])

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
    }
  }, [])

  const handleInputTyping = useCallback(
    (value: string) => {
      setNewMessage(value)

      if (!isConnected) return

      const isNowTyping = value.trim().length > 0

      if (isNowTyping && !userTypingRef.current) {
        userTypingRef.current = true
        broadcastTypingStatus(true)
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = setTimeout(() => {
        if (userTypingRef.current) {
          userTypingRef.current = false
          broadcastTypingStatus(false)
        }
      }, 1200)

      if (!isNowTyping && userTypingRef.current) {
        userTypingRef.current = false
        broadcastTypingStatus(false)
      }
    },
    [broadcastTypingStatus, isConnected]
  )

  const handleSendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!newMessage.trim() && !imagePreviewUrl) return
      if (!isConnected) return

      let uploadedImageUrl: string | null = null

      // Upload image if selected (and not already uploaded)
      if (selectedImageFile && imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
        setIsUploadingImage(true)
        try {
          const formData = new FormData()
          formData.append('file', selectedImageFile)

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })

          const data = await response.json()
          if (!response.ok || !data.secureUrl) {
            throw new Error(data.error || 'Upload failed')
          }

          uploadedImageUrl = data.secureUrl
        } catch (err) {
          console.error('Image upload error:', err)
          setIsUploadingImage(false)
          return
        } finally {
          setIsUploadingImage(false)
        }
      } else if (imagePreviewUrl && !imagePreviewUrl.startsWith('blob:')) {
        // Already uploaded URL
        uploadedImageUrl = imagePreviewUrl
      }

      const messageData = {
        content: newMessage || null,
        imageUrl: uploadedImageUrl || null,
      }

      // Send to backend for persistence
      fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData),
      })
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) {
            console.error('❌ API rejected message:', res.status, data)
          } else {
            const recipientId = typeof data?.recipient_id === 'string' ? data.recipient_id : null
            if (recipientId) {
              await broadcastUnreadIncrement({ recipientId, delta: 1 })
            }
            window.dispatchEvent(new Event('messages:changed'))
          }
        })
        .catch((err) => console.error('❌ Failed to persist message:', err))

      // Send to realtime chat (content + image) for immediate UI update
      sendMessage({
        content: newMessage || null,
        imageUrl: uploadedImageUrl || null,
      })

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      if (userTypingRef.current) {
        userTypingRef.current = false
        broadcastTypingStatus(false)
      }
      
      setNewMessage('')
      setSelectedImageFile(null)
      setImagePreviewUrl(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [newMessage, imagePreviewUrl, selectedImageFile, isConnected, sendMessage, broadcastTypingStatus, broadcastUnreadIncrement]
  )

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const response = await fetch(`/api/messages?id=${messageId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Delete error:', response.status, errorData)
          throw new Error(`Failed to delete message: ${response.status}`)
        }

        // Delete from sender view after server confirms authorization.
        deleteMessageLocally(messageId)

        // Broadcast the deletion to all connected clients
        await broadcastDeleteMessage(messageId)
        window.dispatchEvent(new Event('messages:changed'))
      } catch (error) {
        console.error('❌ Failed to delete message:', error)
        throw error
      }
    },
    [deleteMessageLocally, broadcastDeleteMessage]
  )

  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      try {
        // Immediately edit in sender's view
        updateMessageLocally(messageId, { content: newContent, is_edited: true })

        const response = await fetch('/api/messages', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'edit',
            messageId,
            content: newContent,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Edit API error:', response.status, errorData)
          throw new Error(`Failed to edit message: ${response.status}`)
        }

        // Broadcast the edit to all connected clients
        await broadcastEditMessage(messageId, newContent)
        window.dispatchEvent(new Event('messages:changed'))
      } catch (error) {
        console.error('❌ Failed to edit message:', error)
        throw error
      }
    },
    [updateMessageLocally, broadcastEditMessage]
  )

  const handleSelectImageFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      setSelectedImageFile(file)
      const preview = URL.createObjectURL(file)
      setImagePreviewUrl(preview)
    },
    []
  )

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground antialiased">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {callPartner ? `Voice call with ${callPartner.name}` : 'Voice call'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {isStartingCall ? 'Preparing call...' : callPartner ? 'Open call page' : 'Waiting for recipient'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleStartCall}
          disabled={!isConnected || !callPartner || isStartingCall}
          title="Open voice call page"
        >
          {isStartingCall ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
        </Button>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 pb-16 md:pb-4 space-y-4">
        {allMessages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation!
          </div>
        ) : null}
        <div className="space-y-1">
          {allMessages.map((message, index) => {
            const prevMessage = index > 0 ? allMessages[index - 1] : null
            const showHeader = !prevMessage || prevMessage.user.name !== message.user.name

            return (
              <div
                key={message.id}
                className="animate-in fade-in slide-in-from-bottom-4 duration-300"
              >
                <ChatMessageItem
                  message={message}
                  isOwnMessage={
                    (message.sender_id ? message.sender_id === currentUserId : false) ||
                    (message.user.id ? message.user.id === currentUserId : false)
                  }
                  showHeader={showHeader}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                />
              </div>
            )
          })}
          {partnerIsTyping ? (
            <div className="px-3 py-2 animate-in fade-in duration-200">
              <div className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80 animate-bounce" />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80 animate-bounce"
                  style={{ animationDelay: '120ms' }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground/80 animate-bounce"
                  style={{ animationDelay: '240ms' }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div ref={sentinelRef} className="h-0 w-full" aria-hidden="true" />
      </div>

      {/* Image preview */}
      {imagePreviewUrl && (
        <div className="flex fixed bottom-1/7 items-end gap-2 px-4 pb-2">
          <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
            <Image
              src={imagePreviewUrl}
              alt="Preview"
              width={80}
              height={80}
              className="w-full h-full object-cover"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setImagePreviewUrl(null)
              setSelectedImageFile(null)
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
              }
            }}
            className="h-8 w-8"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {/* Message input */}
      <form
        onSubmit={handleSendMessage}
        className="fixed inset-x-0 bottom-16 z-30 flex w-full gap-2 border-t border-border bg-card/95 p-4 backdrop-blur supports-backdrop-filter:bg-card/85 md:sticky md:inset-x-auto md:bottom-0"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleSelectImageFile}
          className="hidden"
        />
        
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={!isConnected || isUploadingImage}
          className="shrink-0"
          title="Attach image"
        >
          {isUploadingImage ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </Button>

        <Input
          className={cn(
            'rounded-full bg-background text-sm transition-all duration-300',
            isConnected && (newMessage.trim() || imagePreviewUrl)
              ? 'w-[calc(100%-80px)]'
              : 'w-full'
          )}
          type="text"
          value={newMessage}
          onChange={(e) => handleInputTyping(e.target.value)}
          onBlur={() => {
            if (typingTimeoutRef.current) {
              clearTimeout(typingTimeoutRef.current)
            }
            if (userTypingRef.current) {
              userTypingRef.current = false
              broadcastTypingStatus(false)
            }
          }}
          placeholder="Type a message..."
          disabled={!isConnected}
        />
        {isConnected && (newMessage.trim() || imagePreviewUrl) && (
          <Button
            className="aspect-square rounded-full animate-in fade-in slide-in-from-right-4 duration-300 shrink-0"
            type="submit"
            disabled={!isConnected}
          >
            <Send className="size-4" />
          </Button>
        )}
      </form>

    </div>
  )
}
