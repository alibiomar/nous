// sw-push.js — Push notification service worker
// Place in /public/sw-push.js

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text(), url: '/cinema' };
  }

  event.waitUntil(
    self.registration.showNotification('🎬 Cinema sync', {
      body: data.body,
      icon: '/animated_heart_icon.svg',
      badge: '/animated_heart_icon.svg',
      data: { url: data.url ?? '/cinema' },
      // Vibrate pattern: buzz-pause-buzz
      vibrate: [100, 50, 100],
      // Keep notification visible until user interacts
      requireInteraction: false,
      // Collapse duplicate notifications
      tag: 'cinema-sync',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url ?? '/cinema';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing tab if open
        for (const client of clientList) {
          if (client.url.includes('/cinema') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open new tab
        return clients.openWindow(url);
      })
  );
});
