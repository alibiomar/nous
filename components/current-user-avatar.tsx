'use client'

import { useCurrentUserImage } from '@/hooks/use-current-user-image'
import { useCurrentUserName } from '@/hooks/use-current-user-name'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface CurrentUserAvatarProps {
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  previewUrl?: string | null
  showBorder?: boolean
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
  xl: 'h-20 w-20',
}

export const CurrentUserAvatar = ({
  className,
  size = 'md',
  previewUrl,
  showBorder,
}: CurrentUserAvatarProps) => {
  const profileImage = useCurrentUserImage()
  const name = useCurrentUserName()
  const initials = name
    ?.split(' ')
    ?.map((word) => word[0])
    ?.join('')
    ?.toUpperCase()

  return (
    <Avatar
      className={cn(
        sizeMap[size],
        showBorder && 'ring-2 ring-primary ring-offset-2',
        className,
      )}
    >
      <AvatarImage src={previewUrl || profileImage || undefined} alt={initials || 'User'} />
      <AvatarFallback>{initials || 'U'}</AvatarFallback>
    </Avatar>
  )
}
