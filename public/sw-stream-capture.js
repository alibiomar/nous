const pendingCaptures = new Map();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'WATCH_FOR_M3U8') {
    pendingCaptures.set(event.data.captureId, {
      resolve: null,
      url: null,
    });
  }
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only observe — never intercept cross-origin or non-GET requests
  if (
  event.request.method !== 'GET' ||
  (!url.startsWith(self.location.origin) && !url.includes('.m3u8'))
) {
  return;
}

  if (url.includes('.m3u8')) {
    // Notify clients about the captured URL
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'M3U8_CAPTURED', url });
      });
    });

    // Let the request through natively — don't proxy it
    return;
  }

  // For same-origin GET requests, pass through normally
  event.respondWith(fetch(event.request));
});