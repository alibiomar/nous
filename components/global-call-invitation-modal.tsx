'use client'

import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'

interface GlobalCallInvitationModalProps {
  open: boolean
  callerName?: string
  roomName?: string
  secondsRemaining: number
  onAccept: () => void
  onDecline: () => void
}

export function GlobalCallInvitationModal({
  open,
  callerName,
  roomName,
  secondsRemaining,
  onAccept,
  onDecline,
}: GlobalCallInvitationModalProps) {
  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-100">
      <div className="absolute inset-0 bg-background/55 backdrop-blur-md" onClick={onDecline} />
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card/95 p-5 shadow-2xl">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Incoming voice call</p>
          <h3 className="mt-1 text-lg font-semibold">{callerName ?? 'Someone'} is calling</h3>
          {roomName ? (
            <p className="mt-1 text-xs text-muted-foreground">Room: {roomName}</p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">Auto-declines in {secondsRemaining}s</p>
          <div className="mt-4 flex gap-2">
            <Button type="button" className="flex-1" onClick={onAccept}>
              Accept
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onDecline}>
              Decline
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
