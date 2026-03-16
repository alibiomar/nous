'use client'

import { useUser } from '@/contexts/user'

export const useCurrentUserName = () => {
  const { user } = useUser()
  return user?.name ?? '?'
}
