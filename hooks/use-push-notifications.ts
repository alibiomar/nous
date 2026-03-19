'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type PushStatus = 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'loading';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>('loading');
  const subscriptionRef = useRef<PushSubscription | null>(null);

  // Check current status on mount
  useEffect(() => {
    const check = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }

      try {
        const reg = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' });
        await navigator.serviceWorker.ready;

        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          subscriptionRef.current = existing;
          setStatus('subscribed');
        } else {
          setStatus(Notification.permission === 'granted' ? 'prompt' : 'prompt');
        }
      } catch {
        setStatus('unsupported');
      }
    };

    void check();
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    try {
      setStatus('loading');

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (!vapidKey) {
        console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set');
        setStatus('unsupported');
        return false;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        return false;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
        });

      subscriptionRef.current = subscription;

      // Save to server
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });

      if (!res.ok) throw new Error('Failed to save subscription');

      setStatus('subscribed');
      return true;
    } catch (err) {
      console.error('Push subscribe error:', err);
      setStatus('prompt');
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      const sub = subscriptionRef.current;
      if (!sub) return;

      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });

      await sub.unsubscribe();
      subscriptionRef.current = null;
      setStatus('prompt');
    } catch (err) {
      console.error('Push unsubscribe error:', err);
    }
  }, []);

  // Send push notification to other users
  const sendPushNotification = useCallback(async (message: string): Promise<void> => {
    try {
      await fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    } catch {
      // non-fatal — toast already shown locally
    }
  }, []);

  return { status, subscribe, unsubscribe, sendPushNotification };
}