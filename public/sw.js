// Service worker — Web Push (parity with timeharbor-old public/sw.js; URLs target /app/*)
/* global clients */

self.addEventListener('push', function (event) {
  if (!event.data) {
    console.log('[SW] push received but event.data is null');
    return;
  }
  try {
    let data;
    const raw = event.data.text();
    try {
      data = JSON.parse(raw);
    } catch (_) {
      // DevTools sends plain text — show it directly
      data = { title: 'TimeHuddle', body: raw, data: {} };
    }
    console.log('[SW] push received:', data.title, data.body);
    const notificationData = data.data || {};

    let formattedBody = data.body;

    if (notificationData.type === 'clock-in') {
      formattedBody = `${notificationData.userName} clocked in to ${notificationData.teamName}`;
    } else if (notificationData.type === 'clock-out') {
      const duration = notificationData.duration ? ` (${notificationData.duration})` : '';
      formattedBody = `${notificationData.userName} clocked out of ${notificationData.teamName}${duration}`;
    } else if (notificationData.type === 'ticket-timer-start') {
      formattedBody = `${notificationData.userName} started timer on "${notificationData.ticketTitle || notificationData.ticketId}"`;
    } else if (notificationData.type === 'ticket-timer-stop') {
      formattedBody = `${notificationData.userName} stopped timer on "${notificationData.ticketTitle || notificationData.ticketId}"`;
    } else if (notificationData.type === 'message') {
      formattedBody = notificationData.senderName
        ? `${notificationData.senderName}: ${data.body}`
        : data.body;
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

    event.waitUntil(
      self.registration
        .showNotification(data.title, options)
        .then(() => console.log('[SW] showNotification ok'))
        .catch((err) => console.error('[SW] showNotification error:', err)),
    );
  } catch (error) {
    console.error('[Service Worker] Error processing push:', error);
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const notificationData = event.notification.data || {};

  // shift-end-reminder: post a message to the open window so the app can open
  // the shift-end modal in-place, without navigating away from the current page.
  if (notificationData.type === 'shift-end-reminder') {
    event.waitUntil(
      clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(function (windowClients) {
          const msg = {
            type: 'timehuddle:openShiftReminder',
            clockEventId: notificationData.clockEventId,
            teamId: notificationData.teamId,
          };
          if (windowClients.length > 0) {
            windowClients[0].postMessage(msg);
            return windowClients[0].focus();
          }
          // No open window — open the app; ShiftReminderContext will hydrate from inbox on load
          if (clients.openWindow) {
            return clients.openWindow('/app/dashboard');
          }
        })
        .catch((err) => console.error('[Service Worker] Error handling notification click:', err)),
    );
    return;
  }

  let urlToOpen = notificationData.url || event.notification.data?.url || '/app/dashboard';
  console.log('[SW] notificationclick - raw URL:', urlToOpen);

  // Normalise legacy paths (preserve query string)
  if (typeof urlToOpen === 'string' && urlToOpen.startsWith('/') && !urlToOpen.startsWith('/app')) {
    if (urlToOpen === '/' || urlToOpen === '') urlToOpen = '/app/dashboard';
    else if (urlToOpen.startsWith('/member/')) urlToOpen = '/app/clock';
    else urlToOpen = `/app${urlToOpen}`;
  }
  console.log('[SW] notificationclick - normalized URL:', urlToOpen);

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (windowClients) {
        const abs = new URL(urlToOpen, self.location.origin).href;

        if (windowClients.length > 0) {
          // App is open (foreground) — post message so React router handles navigation
          // without a full page reload
          windowClients[0].postMessage({ type: 'timehuddle:navigate', url: urlToOpen });
          return windowClients[0].focus();
        }

        // App is closed/background — open it directly
        if (clients.openWindow) {
          return clients.openWindow(abs);
        }
      })
      .catch((err) => console.error('[Service Worker] Error handling notification click:', err)),
  );
});

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(clients.claim());
});