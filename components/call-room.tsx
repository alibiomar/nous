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

  const callerInitial = activeSession.partnerName?.charAt(0)?.toUpperCase() || '?'
  const callStatus = isInCall ? 'In call' : isDialing ? 'Ringing...' : 'Connecting...'

  return (
    <div className="relative flex h-full min-h-[calc(100vh-10rem)] w-full items-center justify-center overflow-hidden px-3 py-4 md:px-6 md:py-8">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-20 top-20 h-60 w-60 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -right-12 top-8 h-52 w-52 rounded-full bg-secondary/60 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-64 w-72 -translate-x-1/2 rounded-full bg-foreground/15 blur-3xl" />
      </div>

      <div className="glass-panel-strong mx-auto flex w-full max-w-xl flex-col rounded-4xl p-6 md:p-8">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Voice call</p>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{activeSession.partnerName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{callStatus}</p>
        </div>

        <div className="relative mx-auto mt-8 flex h-40 w-40 items-center justify-center rounded-full border border-white/50 bg-linear-to-br from-primary/35 via-background/80 to-secondary/45 shadow-[0_20px_45px_rgba(58,54,45,0.18)] md:mt-10 md:h-48 md:w-48">
          <span className="font-serif text-5xl font-semibold text-foreground/90 md:text-6xl">{callerInitial}</span>
          {!isInCall ? <span className="absolute inset-0 animate-ping rounded-full border border-primary/45" /> : null}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:mt-10">
          <Button
            type="button"
            variant="outline"
            onClick={toggleMute}
            disabled={!isInCall && !isDialing}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className="h-12 rounded-2xl border-border/70 bg-background/60"
          >
            {isMuted ? <MicOff className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}
            {isMuted ? 'Muted' : 'Mic on'}
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              endCall()
              router.replace('/messages')
            }}
            className="h-12 rounded-2xl"
            title="End call"
          >
            <PhoneOff className="mr-2 size-4" />
            End call
          </Button>
        </div>

        <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {speakerVolume <= 0.01 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              Speaker
            </div>
            <p className="text-xs text-muted-foreground">{Math.round(speakerVolume * 100)}%</p>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={speakerVolume}
            onChange={(event) => setSpeakerVolume(Number(event.target.value))}
            aria-label="Speaker volume"
            className="mt-2 h-1.5 w-full cursor-pointer accent-primary"
          />
        </div>

        <div className="mt-4 text-center text-sm text-muted-foreground">
          {isInCall ? 'Your call is live. You can keep browsing while connected.' : 'Preparing secure channel...'}
        </div>

        {!channelConnected ? (
          <div className="mt-3 inline-flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Connecting signaling channel...
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
