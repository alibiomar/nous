'use client'

import { useUser } from '@/contexts/user'

export const useCurrentUserImage = () => {
  const { user } = useUser()
  return user?.avatarUrl ?? null
}
