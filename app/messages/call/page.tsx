'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import { CallRoom } from '../../../components/call-room'
import { CALL_SESSION_STORAGE_KEY, type CallSession } from '../../../contexts/call'

function CallPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [session, setSession] = useState<CallSession | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    const roomFromUrl = searchParams.get('room')

    if (!roomFromUrl) {
      router.replace('/messages')
      return
    }

    try {
      const raw = sessionStorage.getItem(CALL_SESSION_STORAGE_KEY)
      if (!raw) {
        router.replace('/messages')
        return
      }

      const parsed = JSON.parse(raw) as CallSession

      if (!parsed?.roomName || parsed.roomName !== roomFromUrl) {
        router.replace('/messages')
        return
      }

      if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
        sessionStorage.removeItem(CALL_SESSION_STORAGE_KEY)
        router.replace('/messages')
        return
      }

      setSession(parsed)
    } catch (error) {
      console.error('Invalid call session:', error)
      sessionStorage.removeItem(CALL_SESSION_STORAGE_KEY)
      router.replace('/messages')
      return
    } finally {
      setIsChecking(false)
    }
  }, [router, searchParams])

  if (isChecking) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Preparing call...</p>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return <CallRoom session={session} />
}

export default function CallPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Preparing call...</p>
      </div>
    }>
      <CallPageInner />
    </Suspense>
  )
}

