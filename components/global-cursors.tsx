'use client'

import { useUser } from '@/contexts/user'
import { RealtimeCursors } from '@/components/realtime-cursors'

export function GlobalCursors() {
  const { user } = useUser()

  // Only show cursors if user is logged in
  if (!user) return null

  return <RealtimeCursors roomName="nous-global" username={user.name} />
}
