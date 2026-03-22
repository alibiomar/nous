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
  // Use the url the server explicitly sent — this is the source of truth
  const targetUrl = data.url ?? '/messages';

  // ── Detect type from body content ─────────────────────────────────────────
  const isCall    = body.includes('calling you') || body.includes('📞');
  const isCinema  = body.includes('played') || body.includes('paused') || body.includes('🎬');
  const isStory   = body.includes('story') || body.includes('✨');
  const isFeed    = body.includes('photo') || body.includes('moment') || body.includes('posted a');
  // fallback: chat message

  const tag = isCall
    ? 'call-invite'
    : isCinema
    ? 'cinema-sync'
    : isStory
    ? 'story-posted'
    : isFeed
    ? 'feed-post'
    : 'chat-message';

  const title = isCall
    ? '📞 Incoming call'
    : isCinema
    ? '🎬 Cinema sync'
    : isStory
    ? '✨ New story'
    : isFeed
    ? '📸 New moment'
    : '💬 New message';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/animated_heart_icon.svg',
      badge: '/animated_heart_icon.svg',
      data: { url: targetUrl },
      vibrate: isCall ? [200, 100, 200, 100, 200] : [100, 50, 100],
      requireInteraction: isCall,
      tag,
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Always use the url embedded in the notification data — never guess
  const url = event.notification.data?.url ?? '/messages';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab whose URL contains the target path
        for (const client of clientList) {
          if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
          }
        }
        // No matching tab open — open a new one
        return clients.openWindow(url);
      })
  );
});