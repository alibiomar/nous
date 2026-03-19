// sw-push.js — Push notification service worker
// Place in /public/sw-push.js

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text(), url: '/messages' };
  }

  const body = data.body ?? '';

  // ── Detect notification type from message content ─────────────────────────
  const isCall   = body.includes('calling you') || body.includes('📞');
  const isCinema = body.includes('played') || body.includes('paused') || body.includes('🎬');
  // anything else is a chat message

  const url = data.url ?? (isCinema ? '/cinema' : '/messages');

  // Each type gets its own tag so they don't collapse each other
  const tag   = isCall ? 'call-invite' : isCinema ? 'cinema-sync' : 'chat-message';
  const title = isCall ? '📞 Incoming call' : isCinema ? '🎬 Cinema sync' : '💬 New message';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/animated_heart_icon.svg',
      badge: '/animated_heart_icon.svg',
      data: { url },
      // Longer vibrate pattern for calls to feel more urgent
      vibrate: isCall ? [200, 100, 200, 100, 200] : [100, 50, 100],
      // Keep call notifications visible until the user explicitly dismisses them
      requireInteraction: isCall,
      tag,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url   = event.notification.data?.url ?? '/messages';
  const tag   = event.notification.tag;

  // Determine which path to look for when focusing an existing tab
  const targetPath = tag === 'cinema-sync' ? '/cinema' : '/messages';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetPath) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});