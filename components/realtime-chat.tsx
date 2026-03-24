'use client'

import { Image as ImageIcon, Send, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import Image from 'next/image'

import { cn } from '@/lib/utils'
import { ChatMessageItem } from '@/components/chat-message'
import { useChatScroll } from '@/hooks/use-chat-scroll'
import { usePushNotifications } from '@/hooks/use-push-notifications' // <-- Added import
import {
  useRealtimeChat,
  type ChatMessage,
} from '@/hooks/use-realtime-chat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  const { containerRef, sentinelRef, scrollToBottom, scrollToBottomIfAtBottom } = useChatScroll()
  const { sendPushNotification } = usePushNotifications() // <-- Initialized the hook
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userTypingRef = useRef(false)
  const initialScrolledRef = useRef(false)
  const hasScrolledOnceRef = useRef(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({}) // tempId → 0-100
  const {
    messages: realtimeMessages,
    sendMessage,
    isConnected,
    partnerIsTyping,
    peerDirectory,
    broadcastEditMessage,
    broadcastDeleteMessage,
    broadcastUnreadIncrement,
    broadcastTypingStatus,
    broadcastPeerPresence,
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

  const getMessageTimestamp = useCallback((message: ChatMessage) => {
    const rawTimestamp = message.createdAt ?? (message as { created_at?: string | null }).created_at ?? null
    const parsedTimestamp = rawTimestamp ? Date.parse(rawTimestamp) : Number.NaN

    return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp
  }, [])

  // Merge realtime messages with initial messages
const allMessages = useMemo(() => {
    const normalizedMessages = realtimeMessages.map((message) => {
      // Safely resolve the user ID regardless of how the payload came in
      const resolvedUserId = message.user?.id ?? message.sender_id;
      
      return {
        ...message,
        sender_id: resolvedUserId, // Guarantee sender_id is populated for the UI check
        user: {
          id: resolvedUserId,
          name: message.user?.name?.trim() || 'Unknown user',
          // Handle both snake_case and camelCase data payloads
          avatar_url: message.user?.avatar_url ?? (message.user as any)?.avatarUrl ?? null,
        },
      };
    })

    const sortedMessages = [...normalizedMessages].sort((a, b) => {
      return getMessageTimestamp(a) - getMessageTimestamp(b)
    })
    return sortedMessages
  }, [getMessageTimestamp, realtimeMessages])

  useEffect(() => {
    if (!isConnected) {
      return
    }

    const heartbeatId = `${currentUserId}-online`
    broadcastPeerPresence(heartbeatId)

    const interval = setInterval(() => {
      broadcastPeerPresence(heartbeatId)
    }, 15000)

    return () => {
      clearInterval(interval)
    }
  }, [broadcastPeerPresence, currentUserId, isConnected])


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
    if (!newMessage.trim() && !selectedImageFile) return

    const tempId = crypto.randomUUID()
    const localTimestamp = new Date().toISOString()
    const localBlobUrl = imagePreviewUrl // capture before clearing

    // 1. Send optimistically with blob URL immediately
    sendMessage({
      id: tempId,
      content: newMessage || null,
      imageUrl: localBlobUrl || null,
      createdAt: localTimestamp,
    })

    // Clear input immediately
    setNewMessage('')
    setSelectedImageFile(null)
    setImagePreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    if (userTypingRef.current) {
      userTypingRef.current = false
      broadcastTypingStatus(false)
    }

    // 2. Upload image in background if any
    let uploadedImageUrl: string | null = null
    if (selectedImageFile && localBlobUrl) {
    setIsUploadingImage(true)

      setUploadProgress((prev) => ({ ...prev, [tempId]: 0 }))

      try {
        uploadedImageUrl = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const formData = new FormData()
          formData.append('file', selectedImageFile)

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100)
              setUploadProgress((prev) => ({ ...prev, [tempId]: pct }))
            }
          })

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              const data = JSON.parse(xhr.responseText)
              if (data.secureUrl) resolve(data.secureUrl)
              else reject(new Error('No secureUrl'))
            } else {
                  console.error('Upload 400 body:', xhr.responseText)  // ← add this

              reject(new Error(`Upload failed: ${xhr.status}`))
            }
          })

          xhr.addEventListener('error', () => reject(new Error('Network error')))
          xhr.open('POST', '/api/upload')
          xhr.withCredentials = true   // ← add this
          xhr.send(formData)
        })

        // Swap blob URL → real URL in local state
        updateMessageLocally(tempId, { image_url: uploadedImageUrl })
      } catch (err) {
        console.error('Image upload error:', err)
        // Keep the blob preview, mark as failed
        updateMessageLocally(tempId, { content: (newMessage || '') + ' [image upload failed]' })
      } finally {
        setIsUploadingImage(false)

        setUploadProgress((prev) => {
          const next = { ...prev }
          delete next[tempId]
          return next
        })
      }
    }

    // 3. Persist to DB
    fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: newMessage || null,
        imageUrl: uploadedImageUrl || null,
        clientTimestamp: localTimestamp,
      }),
    })
    .then(async (res) => {
      const data = await res.json()
      if (res.ok && data.id) {
        updateMessageLocally(tempId, {
          id: data.id,
          createdAt: data.created_at,
        })
        const recipientId = typeof data?.recipient_id === 'string' ? data.recipient_id : null
        if (recipientId) await broadcastUnreadIncrement({ recipientId, delta: 1 })
        window.dispatchEvent(new Event('messages:changed'))
      }
    })
    .catch((err) => console.error('Failed to save message to DB:', err))

    void sendPushNotification(
      newMessage.trim()
        ? `${username}: ${newMessage.trim().slice(0, 100)}`
        : `${username} sent an image`,
      { url: '/messages', senderId: currentUserId }
    )
  },
  [
    newMessage, imagePreviewUrl, selectedImageFile,
    sendMessage, broadcastTypingStatus, broadcastUnreadIncrement,
    username, currentUserId, sendPushNotification, updateMessageLocally,
  ]
)
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const response = await fetch(`/api/messages/${messageId}`, {
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
        console.error('Failed to delete message:', error)
        throw error
      }
    },
    [deleteMessageLocally, broadcastDeleteMessage]
  )
const handleEditMessage = useCallback(
  async (messageId: string, newContent: string) => {
    updateMessageLocally(messageId, { content: newContent, is_edited: true })

    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('Edit API error:', response.status, errorData)
        throw new Error(`Failed to edit message: ${response.status}`)
      }

      // ADD THIS — confirm broadcast is reached
      console.log('Broadcasting edit, isConnected:', isConnected)
      await broadcastEditMessage(messageId, newContent)
      window.dispatchEvent(new Event('messages:changed'))
    } catch (error) {
      console.error('Failed to edit message:', error)
      throw error
    }
  },
  [updateMessageLocally, broadcastEditMessage, isConnected] // ← isConnected added
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
    <div className="relative flex h-full min-h-0 w-full rounded-lg flex-col text-foreground overflow-hidden">

      {/* Messages */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full space-y-4 overflow-y-auto p-3 pb-4 md:p-6 md:pb-4">
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
                  // Cleaned up: Since we guaranteed sender_id above, this check is now safe
                  isOwnMessage={message.sender_id === currentUserId}
                  showHeader={showHeader}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  uploadProgress={uploadProgress[message.id] ?? null} 
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
        <div className="absolute bottom-20 left-3 flex items-start gap-2 bg-transparent">

          <div className="relative w-20 h-20 rounded-lg overflow-hidden">
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
            variant="secondary"
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
        className="glass-panel pointer-events-auto mt-2 flex w-full gap-2 rounded-2xl border border-border/70 p-3"
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
          disabled={isUploadingImage}
          className="shrink-0"
          title="Attach image"
        >
          {isUploadingImage ? (
            <img src="/animated_heart_icon.svg" alt="Loading" className="size-4" />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </Button>

        <Input
          className={cn(
            'pointer-events-auto rounded-full text-sm transition-all duration-300',
            (newMessage.trim() || imagePreviewUrl)
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
        />
        {(newMessage.trim() || imagePreviewUrl) && (
          <Button
            className="aspect-square rounded-full animate-in fade-in slide-in-from-right-4 duration-300 shrink-0"
            type="submit"
          >
            <Send className="size-4" />
          </Button>
        )}
      </form>

    </div>
  )
}