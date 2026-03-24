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
  uploadProgress?: number | null
}

export const ChatMessageItem = ({ 
  message, 
  isOwnMessage, 
  showHeader,
  onEdit,
  onDelete,
  uploadProgress,
}: ChatMessageItemProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(message.content || '')
  const [isLoading, setIsLoading] = useState(false)
  const [formattedTime, setFormattedTime] = useState('')

  useEffect(() => {
    if (!message.createdAt) return;

    let dateString = message.createdAt;

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

  const isUploading = uploadProgress != null

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
                className={cn(
                  "w-full h-auto object-cover transition-opacity duration-300",
                  isUploading && "opacity-50"
                )}
              />

              {/* Upload progress overlay */}
              {isUploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30">
                  {/* Circular-ish progress bar */}
                  <div className="relative flex items-center justify-center w-12 h-12">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                      <circle
                        cx="22" cy="22" r="18"
                        fill="none"
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth="3"
                      />
                      <circle
                        cx="22" cy="22" r="18"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 18}`}
                        strokeDashoffset={`${2 * Math.PI * 18 * (1 - (uploadProgress ?? 0) / 100)}`}
                        className="transition-all duration-200"
                      />
                    </svg>
                    <span className="absolute text-white text-[10px] font-semibold">
                      {uploadProgress}%
                    </span>
                  </div>
                  <span className="text-white text-[10px] font-medium drop-shadow">Uploading…</span>
                </div>
              )}

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
                        className="h-7 w-7 transition-opacity opacity-100 md:opacity-0 md:group-hover/message:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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