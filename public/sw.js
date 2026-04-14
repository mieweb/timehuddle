// Service worker — Web Push (parity with timeharbor-old public/sw.js; URLs target /app/*)
/* global clients */

self.addEventListener('push', function (event) {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const notificationData = data.data || {};

    let formattedBody = data.body;
    if (notificationData.userName && notificationData.teamName) {
      if (notificationData.type === 'clock-in') {
        formattedBody = `${notificationData.userName} clocked in to ${notificationData.teamName}`;
      } else if (notificationData.type === 'clock-out') {
        const duration = notificationData.duration ? ` (${notificationData.duration})` : '';
        formattedBody = `${notificationData.userName} clocked out of ${notificationData.teamName}${duration}`;
      }
    }

    const options = {
      body: formattedBody,
      icon: data.icon || '/timehuddle-icon.svg',
      badge: data.badge || '/timehuddle-icon.svg',
      tag: data.tag || 'default',
      data: notificationData,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      image: data.image,
      dir: 'ltr',
      silent: false,
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (error) {
    console.error('[Service Worker] Error processing push:', error);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  let urlToOpen = event.notification.data?.url || '/app/dashboard';
  if (typeof urlToOpen === 'string' && urlToOpen.startsWith('/') && !urlToOpen.startsWith('/app')) {
    if (urlToOpen === '/' || urlToOpen === '') urlToOpen = '/app/dashboard';
    else if (urlToOpen.startsWith('/member/')) urlToOpen = '/app/messages';
    else urlToOpen = `/app${urlToOpen}`;
  }

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windowClients) {
        const pathPrefix = urlToOpen.split('?')[0] || urlToOpen;
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url.includes(pathPrefix) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          const abs = new URL(urlToOpen, self.location.origin).href;
          return clients.openWindow(abs);
        }
      })
      .catch((err) => console.error('[Service Worker] Error handling notification click:', err)),
  );
});

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});
