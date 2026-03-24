import { useState,useEffect } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/hooks/use-realtime-chat'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Edit2, Trash2, Check, X, MoreHorizontal } from 'lucide-react'

interface ChatMessageItemProps {
  message: ChatMessage
  isOwnMessage: boolean
  showHeader: boolean
  onEdit?: (messageId: string, newContent: string) => Promise<void>
  onDelete?: (messageId: string) => Promise<void>
}

export const ChatMessageItem = ({ 
  message, 
  isOwnMessage, 
  showHeader,
  onEdit,
  onDelete,
}: ChatMessageItemProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(message.content || '')
  const [isLoading, setIsLoading] = useState(false)
  // 1. Start with an empty string so the server and client match initially
  const [formattedTime, setFormattedTime] = useState('')

  // 2. Calculate the local time only after it reaches the user's browser
  useEffect(() => {
    if (!message.createdAt) return;

    let dateString = message.createdAt;

    // Failsafe: ensure the string is treated as UTC even if formatting varies
    if (dateString.includes(' ') && !dateString.includes('+')) {
      dateString = dateString.replace(' ', 'T') + 'Z';
    } else if (!dateString.endsWith('Z') && !dateString.includes('+')) {
      dateString += 'Z';
    }

    const time = new Date(dateString).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    setFormattedTime(time);
  }, [message.createdAt]);

  const initials = message.user.name
    ?.split(' ')
    ?.map((word) => word[0])
    ?.join('')
    ?.toUpperCase()

  const handleEdit = async () => {
    if (!editedContent.trim()) return
    setIsLoading(true)
    try {
      await onEdit?.(message.id, editedContent)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to edit message:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this message?')) return
    setIsLoading(true)
    try {
      await onDelete?.(message.id)
    } catch (error) {
      console.error('Failed to delete message:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={`group/message flex items-end mt-2 gap-2 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      {!isOwnMessage && (
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.user.avatar_url || undefined} alt={initials} />
          <AvatarFallback className="text-xs">{initials || 'U'} </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn('max-w-[75%] flex flex-col gap-1', {
          'items-end': isOwnMessage,
        })}
      >
        {showHeader && (
          <div
            className={cn('flex items-center gap-2 text-xs px-3', {
              'justify-end flex-row-reverse': isOwnMessage,
            })}
          >
            <span className={'font-medium'}>{message.user.name}</span>
          </div>
        )}
        <div className="space-y-2">
          {message.image_url && (
            <div className="relative overflow-hidden rounded-lg max-w-sm">
              <Image
                src={message.image_url}
                alt="Message image"
                width={500}
                height={400}
                className="w-full h-auto object-cover"
              />
              <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {formattedTime}
              </span>
            </div>
          )}
          {isEditing ? (
            <div className="flex gap-2 items-center">
              <Input
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="text-sm"
                disabled={isLoading}
              />
              <Button
                size="icon"
                className="h-7 w-7"
                onClick={handleEdit}
                disabled={isLoading || !editedContent.trim()}
              >
                <Check className="size-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setIsEditing(false)
                  setEditedContent(message.content || '')
                }}
                disabled={isLoading}
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center ">

              {isOwnMessage && (
                <div className="flex gap-1 px-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
                        disabled={isLoading}
                        title="Message actions"
                        aria-label="Message actions"
                      >
                        <MoreHorizontal className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setIsEditing(true)}>
                        <Edit2 className="size-3" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={handleDelete}>
                        <Trash2 className="size-3" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
                            {message.content && (
                <div
                  className={cn(
                    'py-2 px-3 rounded-xl text-sm w-fit',
                    isOwnMessage ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span>{message.content}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-70">
                    {message.is_edited && <span>(edited)</span>}
                    <span>{formattedTime || '\u00A0'}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {isOwnMessage && (
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.user.avatar_url || undefined} alt={initials} />
          <AvatarFallback className="text-xs">{initials || 'U'}</AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}