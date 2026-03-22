'use client'

import { useRouter } from 'next/navigation'
import Peer, { type MediaConnection } from 'peerjs'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { GlobalCallInvitationModal } from '@/components/global-call-invitation-modal'
import { useUser } from '@/contexts/user'
import { createClient } from '@/lib/client'

export const CALL_SESSION_STORAGE_KEY = 'nous:call-session'
const CALL_RING_TIMEOUT_MS = 30000
const CALL_INVITE_EVENT = 'call:invite'
const CALL_INVITE_CLEAR_EVENT = 'call:invite:clear'
const CALL_DECLINE_EVENT = 'call:decline'
const CALL_RINGING_EVENT = 'call:ringing'
const CALL_INVITE_CHANNEL = 'global-call-invites'

interface CallInvitePayload {
  roomName: string
  baseRoomName: string
  fromUserId: string
  fromUsername: string
  toUserId: string
}

interface PeerPresencePayload {
  userId: string
  peerId: string
}

type RealtimeSubscribeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR'

export interface CallSession {
  roomName: string
  baseRoomName: string
  role: 'caller' | 'callee'
  partnerUserId: string
  partnerName: string
  currentUserId: string
  currentUserName: string
  expiresAt: number
}

interface IncomingCallInvite {
  roomName: string
  baseRoomName: string
  fromUserId: string
  fromUsername: string
}

interface CallContextType {
  session: CallSession | null
  isDialing: boolean
  isInCall: boolean
  isMuted: boolean
  speakerVolume: number
  error: string | null
  channelConnected: boolean
  startCallSession: (session: Omit<CallSession, 'expiresAt'>) => void
  inviteAndStartCall: (params: { partnerUserId: string; partnerName: string; baseRoomName: string }) => Promise<void>
  endCall: () => void
  toggleMute: () => void
  setSpeakerVolume: (value: number) => void
}

const CallContext = createContext<CallContextType | undefined>(undefined)

export function CallProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { user } = useUser()

  const peerRef = useRef<Peer | null>(null)
  const activeCallRef = useRef<MediaConnection | null>(null)
  const callStartTimeRef = useRef<number | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLVideoElement | null>(null)
  // Keep volume in a ref so volume slider changes do not recreate call event bindings.
  const speakerVolumeRef = useRef(1)
  const dialAudioRef = useRef<HTMLAudioElement | null>(null)
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inviteChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const voiceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const channelConnectedRef = useRef(false)

  const sessionRef = useRef<CallSession | null>(null)
  const [session, setSessionState] = useState<CallSession | null>(null)

  const setSession = useCallback((newSession: CallSession | null) => {
    sessionRef.current = newSession
    setSessionState(newSession)
  }, [])
  const [incomingInvite, setIncomingInvite] = useState<IncomingCallInvite | null>(null)
  const [inviteCountdown, setInviteCountdown] = useState(30)
  const [voiceChannelConnected, setVoiceChannelConnected] = useState(false)
  const [localPeerId, setLocalPeerId] = useState<string | null>(null)
  const [peerDirectory, setPeerDirectory] = useState<Record<string, string>>({})
  const [isDialing, setIsDialing] = useState(false)
  const [isPartnerRinging, setIsPartnerRinging] = useState(false)
  const [isInCall, setIsInCall] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [speakerVolume, setSpeakerVolumeState] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    speakerVolumeRef.current = speakerVolume
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = speakerVolume
    }
  }, [speakerVolume])

  const partnerPeerId = useMemo(() => {
    if (!session) return undefined
    return peerDirectory[session.partnerUserId]
  }, [peerDirectory, session])

  const clearRingTimeout = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current)
      ringTimerRef.current = null
    }
  }, [])

  const stopLocalStream = useCallback(() => {
    if (!localStreamRef.current) return

    localStreamRef.current.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    setIsMuted(false)
  }, [])

  const clearSessionStorage = useCallback(() => {
    sessionStorage.removeItem(CALL_SESSION_STORAGE_KEY)
  }, [])

  const ensureLocalAudioStream = useCallback(async () => {
    if (localStreamRef.current?.active) {
      return localStreamRef.current
    }



    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    localStreamRef.current = stream
    return stream
  }, [])

  const sendInviteClear = useCallback(
    async (toUserId: string) => {
      if (!toUserId) return

      // wait up to 4s for channel to connect
      for (let i = 0; i < 40; i++) {
        if (channelConnectedRef.current) break
        await new Promise((r) => setTimeout(r, 100))
      }

      const liveChannel = inviteChannelRef.current
      if (!liveChannel) return

      if (channelConnectedRef.current) {
        try {
          await liveChannel.send({
            type: 'broadcast',
            event: CALL_INVITE_CLEAR_EVENT,
            payload: { toUserId },
          })
        } catch (err) {
          console.error('Failed to send clear invite broadcast:', err)
        }
      }
    },
    []
  )

  const sendInvite = useCallback(
    async (payload: CallInvitePayload) => {
      // wait up to 4s for channel to connect
      for (let i = 0; i < 40; i++) {
        if (channelConnectedRef.current) break
        await new Promise((r) => setTimeout(r, 100))
      }

      if (!channelConnectedRef.current) {
        throw new Error('Call invite channel is not connected yet. Please try again in a moment.')
      }

      const liveChannel = inviteChannelRef.current
      if (!liveChannel) throw new Error('Invite channel not found')

      await liveChannel.send({
        type: 'broadcast',
        event: CALL_INVITE_EVENT,
        payload,
      })
    },
    []
  )

  const persistCallMessage = useCallback(async (content: string, roomName?: string) => {
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, imageUrl: null }),
      })

      if (response.ok) {
        const messageData = await response.json()

        const chatMessage = {
          id: messageData.id,
          sender_id: messageData.sender_id,
          content: messageData.content,
          image_url: messageData.image_url,
          user: {
            id: messageData.sender?.id || messageData.sender_id,
            name: messageData.sender?.name || 'Unknown',
            avatar_url: messageData.sender?.avatar_url || null,
          },
          createdAt: messageData.created_at,
        }

        window.dispatchEvent(new CustomEvent('chat:add_message', { detail: chatMessage }))

        if (roomName) {
          const chatChannel = supabase.channel(roomName)
          await chatChannel.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              chatChannel.send({
                type: 'broadcast',
                event: 'message',
                payload: chatMessage,
              }).catch((e: unknown) => console.error('Failed to emit message', e))
              
              // cleanup
              setTimeout(() => { supabase.removeChannel(chatChannel) }, 1000)
            }
          })
        }
      }
    } catch (requestError) {
      console.error('Failed to save call message:', requestError)
    }
  }, [supabase])

  const endCall = useCallback((isRemote = false) => {
    // Notify the other peer if we initiated the hangup
    if (!isRemote && voiceChannelRef.current) {
      voiceChannelRef.current.send({
        type: 'broadcast',
        event: 'call:ended',
        payload: {},
      }).catch((err: unknown) => console.error('Failed to broadcast call end:', err))
    }

    const currentSession = sessionRef.current

    // If we're the caller and cancelling, we should ensure the invite is cleared
    if (!isRemote && currentSession?.role === 'caller') {
      void sendInviteClear(currentSession.partnerUserId)
    }

    clearRingTimeout()
    activeCallRef.current?.close()
    activeCallRef.current = null

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null
    }

    stopLocalStream()
    setIsDialing(false)
    setIsPartnerRinging(false)
    setIsInCall(false)
    setError(null)
    setPeerDirectory({})
    setSession(null)
    clearSessionStorage()

    if (callStartTimeRef.current) {
      const duration = Math.round((Date.now() - callStartTimeRef.current) / 1000)
      const mins = Math.floor(duration / 60)
      const secs = duration % 60
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
      
      if (currentSession?.role === 'caller') {
        void persistCallMessage(`Voice call ended (${timeStr}).`, currentSession.baseRoomName)
      }
      callStartTimeRef.current = null
    }
  }, [clearRingTimeout, clearSessionStorage, stopLocalStream, persistCallMessage, setSession, sendInviteClear])

  const bindCallEvents = useCallback(
    (call: MediaConnection) => {
      activeCallRef.current = call

      call.on('stream', (remoteStream) => {
        clearRingTimeout()
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream
          remoteAudioRef.current.autoplay = true
          remoteAudioRef.current.playsInline = true
          remoteAudioRef.current.muted = false
          remoteAudioRef.current.setAttribute('playsinline', '')
          remoteAudioRef.current.setAttribute('webkit-playsinline', '')
          remoteAudioRef.current.volume = speakerVolumeRef.current
          void remoteAudioRef.current.play().catch(() => {
            // Browser autoplay may block audio until user interaction.
          })
        }

        setError(null)
        setIsDialing(false)
        setIsInCall(true)
        if (!callStartTimeRef.current) {
          callStartTimeRef.current = Date.now()
        }
      })

      call.on('close', () => {
        // Just trigger endCall(true) so we don't broadcast infinitely
        endCall(true)
      })

      call.on('error', (callError) => {
        console.error('Call error:', callError)
        setError(callError.message || 'Voice call failed')
        endCall(true)
      })
    },
    [clearRingTimeout, endCall]
  )

  const startCallSession = useCallback(
    (rawSession: Omit<CallSession, 'expiresAt'>) => {
      const prepared: CallSession = {
        ...rawSession,
        expiresAt: Date.now() + 10 * 60_000,
      }

      setSession(prepared)
      setPeerDirectory({})
      setError(null)
      setIsPartnerRinging(false)
      setIsDialing(prepared.role === 'caller')
      setIsInCall(false)
      sessionStorage.setItem(CALL_SESSION_STORAGE_KEY, JSON.stringify(prepared))
      router.push(`/messages/call?room=${encodeURIComponent(prepared.roomName)}`)
    },
    [router]
  )

  const inviteAndStartCall = useCallback(
    async ({ partnerUserId, partnerName, baseRoomName }: { partnerUserId: string; partnerName: string; baseRoomName: string }) => {
      if (!user?.id || !user.name) {
        throw new Error('User session not ready')
      }

      try {
        // Explicitly ask for microphone permissions BEFORE sending the call invite
        await ensureLocalAudioStream()
      } catch (err: unknown) {
        console.error('Microphone access denied:', err)
        const msg = err instanceof Error ? err.message : 'Microphone access is required to make a call.'
        alert(`Call failed: ${msg}`)
        return
      }

      const callRoomName = `voice-call-${baseRoomName}-${user.id}-${Date.now()}`

      await sendInvite({
        roomName: callRoomName,
        baseRoomName: baseRoomName,
        fromUserId: user.id,
        fromUsername: user.name,
        toUserId: partnerUserId,
      })

      // Push notification to partner — fires even if their tab is closed
      void fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `📞 ${user.name} is calling you`, url: '/messages' }),
      }).catch(() => undefined)

      startCallSession({
        roomName: callRoomName,
        baseRoomName: baseRoomName,
        role: 'caller',
        partnerUserId,
        partnerName,
        currentUserId: user.id,
        currentUserName: user.name,
      })
    },
    [sendInvite, startCallSession, user?.id, user?.name, ensureLocalAudioStream]
  )

  const declineInvite = useCallback(async () => {
    if (!incomingInvite) return

    await sendInviteClear(incomingInvite.fromUserId)
    
    // Tell the caller that we declined
    const liveChannel = inviteChannelRef.current
    if (liveChannel && channelConnectedRef.current) {
      await liveChannel.send({
        type: 'broadcast',
        event: CALL_DECLINE_EVENT,
        payload: { toUserId: incomingInvite.fromUserId },
      })
    }

    setIncomingInvite(null)
    setInviteCountdown(30)
  }, [incomingInvite, sendInviteClear])

  const acceptInvite = useCallback(async () => {
    if (!incomingInvite || !user) return

    try {
      // Explicitly ask for microphone permissions BEFORE joining the call
      await ensureLocalAudioStream()
    } catch (err: unknown) {
      console.error('Microphone access denied:', err)
      const msg = err instanceof Error ? err.message : 'Microphone access is required to accept a call.'
      alert(`Call failed: ${msg}`)
      // Optionally decline the invite so it doesn't just hang
      await declineInvite()
      return
    }

    await sendInviteClear(incomingInvite.fromUserId)

    startCallSession({
      roomName: incomingInvite.roomName,
      baseRoomName: incomingInvite.baseRoomName,
      role: 'callee',
      partnerUserId: incomingInvite.fromUserId,
      partnerName: incomingInvite.fromUsername,
      currentUserId: user.id,
      currentUserName: user.name,
    })

    setIncomingInvite(null)
    setInviteCountdown(30)
  }, [incomingInvite, sendInviteClear, startCallSession, user, ensureLocalAudioStream, declineInvite])

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return

    const nextMuted = !isMuted
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted
    })
    setIsMuted(nextMuted)
  }, [isMuted])

  const setSpeakerVolume = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(1, value))
    setSpeakerVolumeState(normalized)
    speakerVolumeRef.current = normalized

    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = normalized
    }
  }, [])

  // Initialize audio elements globally
  useEffect(() => {
    if (typeof window !== 'undefined') {
      dialAudioRef.current = new Audio('/dial.mp3')
      dialAudioRef.current.loop = true
      
      ringtoneAudioRef.current = new Audio('/ringtone.mp3')
      ringtoneAudioRef.current.loop = true
    }
  }, [])

  // Manage dial sound playback
  useEffect(() => {
    const dialAudio = dialAudioRef.current
    if (!dialAudio) return

    if (isDialing && isPartnerRinging && session?.role === 'caller') {
      dialAudio.currentTime = 0
      dialAudio.play().catch(e => console.warn('Dial audio play prevented:', e))
    } else {
      dialAudio.pause()
    }

    return () => {
      dialAudio.pause()
    }
  }, [isDialing, isPartnerRinging, session?.role])

  // Manage ringtone playback
  useEffect(() => {
    const ringtoneAudio = ringtoneAudioRef.current
    if (!ringtoneAudio) return

    if (incomingInvite) {
      ringtoneAudio.currentTime = 0
      ringtoneAudio.play().catch(e => console.warn('Ringtone play prevented:', e))
    } else {
      ringtoneAudio.pause()
    }

    return () => {
      ringtoneAudio.pause()
    }
  }, [incomingInvite])

  useEffect(() => {
    const raw = sessionStorage.getItem(CALL_SESSION_STORAGE_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as CallSession
      if (parsed.expiresAt > Date.now()) {
        setSession(parsed)
        setIsDialing(parsed.role === 'caller')
      } else {
        clearSessionStorage()
      }
    } catch {
      clearSessionStorage()
    }
  }, [clearSessionStorage])

  useEffect(() => {
    if (!user?.id) return

    const channel = supabase.channel(CALL_INVITE_CHANNEL)
    inviteChannelRef.current = channel

    channel
      .on('broadcast', { event: CALL_INVITE_EVENT }, (payload: { payload: CallInvitePayload }) => {
        const invite = payload.payload
        if (!invite?.toUserId || invite.toUserId !== user.id) return

        setIncomingInvite({
          roomName: invite.roomName,
          baseRoomName: invite.baseRoomName,
          fromUserId: invite.fromUserId,
          fromUsername: invite.fromUsername,
        })
        setInviteCountdown(30)

        // Broadcast back to the caller that our phone is now "ringing"
        channel.send({
          type: 'broadcast',
          event: CALL_RINGING_EVENT,
          payload: { toUserId: invite.fromUserId },
        }).catch((err: unknown) => console.error('Failed to send ringing ack', err))
      })
      .on('broadcast', { event: CALL_RINGING_EVENT }, (payload: { payload: { toUserId: string } }) => {
        if (payload.payload?.toUserId === user.id) {
          setIsPartnerRinging(true)
        }
      })
      .on('broadcast', { event: CALL_INVITE_CLEAR_EVENT }, (payload: { payload: { toUserId: string } }) => {
        if (payload.payload?.toUserId === user.id) {
          setIncomingInvite(null)
          setInviteCountdown(30)
        }
      })
      .on('broadcast', { event: CALL_DECLINE_EVENT }, (payload: { payload: { toUserId: string } }) => {
        if (payload.payload?.toUserId === user.id) {
          setError('Call was declined.')
          if (sessionRef.current) {
            void persistCallMessage('Call declined.', sessionRef.current.baseRoomName)
          } else {
            void persistCallMessage('Call declined.')
          }
          endCall()
        }
      })
      .subscribe((status: RealtimeSubscribeStatus) => {
        const isSubscribed = status === 'SUBSCRIBED'
        channelConnectedRef.current = isSubscribed
      })

    return () => {
      inviteChannelRef.current = null
      channelConnectedRef.current = false
      supabase.removeChannel(channel)
    }
  }, [supabase, user?.id, endCall, persistCallMessage])

  useEffect(() => {
    if (!incomingInvite) {
      setInviteCountdown(30)
      return
    }

    const interval = setInterval(() => {
      setInviteCountdown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [incomingInvite])

  useEffect(() => {
    if (!incomingInvite || inviteCountdown > 0) return
    void declineInvite()
  }, [declineInvite, incomingInvite, inviteCountdown])

  useEffect(() => {
    if (!session) {
      setVoiceChannelConnected(false)
      return
    }

    const channel = supabase.channel(`voice-room:${session.roomName}`)
    voiceChannelRef.current = channel

    channel
      .on('broadcast', { event: 'peer:presence' }, (payload: { payload: PeerPresencePayload }) => {
        const data = payload.payload
        if (!data?.userId || !data?.peerId || data.userId === session.currentUserId) {
          return
        }

        setPeerDirectory((current) => ({
          ...current,
          [data.userId]: data.peerId,
        }))
      })
      .on('broadcast', { event: 'call:ended' }, () => {
        // The other peer hung up, end local seamlessly 
        endCall(true)
      })
      .subscribe((status: RealtimeSubscribeStatus) => {
        setVoiceChannelConnected(status === 'SUBSCRIBED')
      })

    return () => {
      voiceChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [session, supabase, endCall])

  useEffect(() => {
    const peer = new Peer()

    peer.on('open', (id) => {
      setLocalPeerId(id)
    })

    peer.on('call', async (incoming) => {
      try {
        const stream = await ensureLocalAudioStream()
        bindCallEvents(incoming)
        incoming.answer(stream)
      } catch (streamError) {
        console.error('Failed to answer call:', streamError)
        setError('Microphone access is required to answer this call.')
      }
    })

    peer.on('error', (peerError) => {
      console.error('Peer error:', peerError)
      setError(peerError.message || 'Peer connection error')
    })

    peerRef.current = peer

    return () => {
      clearRingTimeout()
      stopLocalStream()
      peer.destroy()
      peerRef.current = null
      setLocalPeerId(null)
    }
  }, [bindCallEvents, clearRingTimeout, ensureLocalAudioStream, stopLocalStream])

  useEffect(() => {
    if (!session || !localPeerId || !voiceChannelConnected) return

    const channel = voiceChannelRef.current
    if (!channel) return

    const broadcast = async () => {
      try {
        await channel.send({
          type: 'broadcast',
          event: 'peer:presence',
          payload: {
            userId: session.currentUserId,
            peerId: localPeerId,
          },
        })
      } catch (err) {
        console.error('Failed to broadcast peer presence:', err)
      }
    }

    void broadcast()

    const interval = setInterval(() => {
      void broadcast()
    }, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [localPeerId, session, voiceChannelConnected])

  useEffect(() => {
    if (!session || session.role !== 'caller') return
    if (!partnerPeerId || isInCall || !peerRef.current) return

    let cancelled = false

    const startCall = async () => {
      try {
        const stream = await ensureLocalAudioStream()
        if (cancelled || !peerRef.current) return

        const call = peerRef.current.call(partnerPeerId, stream, {
          metadata: {
            fromUserId: session.currentUserId,
            fromName: session.currentUserName,
          },
        })

        if (!call) {
          throw new Error('Could not establish call')
        }

        setIsDialing(true)
        bindCallEvents(call)

        clearRingTimeout()
        ringTimerRef.current = setTimeout(() => {
          if (isInCall) return

          call.close()
          setError('No answer. Call timed out.')
          void persistCallMessage(`Missed voice call.`, session.baseRoomName)
        }, CALL_RING_TIMEOUT_MS)
      } catch (startError) {
        console.error('Failed to start outgoing call:', startError)
        setError('Unable to start call. Check microphone permission and try again.')
      }
    }

    void startCall()

    return () => {
      cancelled = true
    }
  }, [
    bindCallEvents,
    clearRingTimeout,
    ensureLocalAudioStream,
    isInCall,
    partnerPeerId,
    persistCallMessage,
    session,
  ])

  const contextValue = useMemo<CallContextType>(
    () => ({
      session,
      isDialing,
      isInCall,
      isMuted,
      speakerVolume,
      error,
      channelConnected: voiceChannelConnected,
      startCallSession,
      inviteAndStartCall,
      endCall,
      toggleMute,
      setSpeakerVolume,
    }),
    [
      endCall,
      error,
      isDialing,
      isInCall,
      isMuted,
      session,
      setSpeakerVolume,
      speakerVolume,
      startCallSession,
      inviteAndStartCall,
      toggleMute,
      voiceChannelConnected,
    ]
  )

  return (
    <CallContext.Provider value={contextValue}>
      {children}
      <GlobalCallInvitationModal
        open={Boolean(incomingInvite)}
        callerName={incomingInvite?.fromUsername}
        roomName={incomingInvite?.roomName}
        secondsRemaining={inviteCountdown}
        onAccept={() => {
          void acceptInvite()
        }}
        onDecline={() => {
          void declineInvite()
        }}
      />
      <video
        ref={remoteAudioRef}
        autoPlay
        playsInline
        muted={false}
        className="sr-only"
        style={{ width: 0, height: 0, position: 'absolute' }}
      />
    </CallContext.Provider>
  )
}

export function useCall() {
  const context = useContext(CallContext)
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider')
  }
  return context
}