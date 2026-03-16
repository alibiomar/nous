'use client'

import { Loader2, Mic, MicOff, PhoneOff, Volume2, VolumeX } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { useCall, type CallSession } from '@/contexts/call'

interface CallRoomProps {
  session: CallSession
}

export function CallRoom({ session }: CallRoomProps) {
  const router = useRouter()
  const {
    session: activeSession,
    isDialing,
    isInCall,
    isMuted,
    speakerVolume,
    error,
    channelConnected,
    endCall,
    toggleMute,
    setSpeakerVolume,
  } = useCall()

  useEffect(() => {
    if (!activeSession || activeSession.roomName !== session.roomName) {
      router.replace('/messages')
    }
  }, [activeSession, router, session.roomName])

  // If there is no active call session, render nothing while redirecting.
  if (!activeSession || activeSession.roomName !== session.roomName) {
    return null
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-4">
      <div className="rounded-2xl border border-border bg-card/70 p-4 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Voice call</p>
            <h1 className="text-xl font-semibold">{activeSession.partnerName}</h1>
            <p className="text-sm text-muted-foreground">
              {isInCall ? 'Connected' : isDialing ? 'Ringing...' : 'Connecting...'}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={() => {
              endCall()
              router.replace('/messages')
            }}
            title="End call"
          >
            <PhoneOff className="size-4" />
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={toggleMute}
            disabled={!isInCall && !isDialing}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>

          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            {speakerVolume <= 0.01 ? (
              <VolumeX className="size-4 text-muted-foreground" />
            ) : (
              <Volume2 className="size-4 text-muted-foreground" />
            )}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={speakerVolume}
              onChange={(event) => setSpeakerVolume(Number(event.target.value))}
              aria-label="Speaker volume"
              className="h-1.5 w-28 cursor-pointer"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-muted/25 p-4 text-sm text-muted-foreground">
        {isInCall ? 'Call is live. You can navigate anywhere and the call will keep running.' : 'Setting up secure voice channel...'}
      </div>

      {!channelConnected ? (
        <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Connecting signaling channel...
        </div>
      ) : null}
    </div>
  )
}
