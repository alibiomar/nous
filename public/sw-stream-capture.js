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

  if (url.includes('.m3u8')) {
    // Notify all clients about the captured m3u8
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'M3U8_CAPTURED',
          url,
        });
      });
    });
  }

  // Always let the request through
  event.respondWith(fetch(event.request));
});