/**
 * Browser Web Push client.
 *
 * VAPID public key is read from the VITE_VAPID_PUBLIC_KEY env var.
 * Server-side subscription management will route through timecore
 * (/v1/notifications/push-subscribe and /v1/notifications/push-unsubscribe)
 * once those endpoints are implemented.
 */
import { TIMECORE_BASE_URL } from './api';

export function isPushNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isPushNotificationSupported()) throw new Error('Push notifications are not supported');
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Register /sw.js (replace existing registrations first). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported');
  const existingRegistrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of existingRegistrations) {
    await registration.unregister();
  }
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration;
}

export async function subscribeToWebPush(): Promise<void> {
  if (!isPushNotificationSupported()) throw new Error('Push notifications are not supported');

  const vapidPublicKey =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
    '';
  if (!vapidPublicKey) throw new Error('VITE_VAPID_PUBLIC_KEY is not configured');

  const permissionGranted = await requestNotificationPermission();
  if (!permissionGranted) throw new Error('Notification permission denied');

  const registration = await registerServiceWorker();
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();

  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const json = subscription.toJSON();
  const res = await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'webpush',
      endpoint: json.endpoint,
      keys: json.keys,
      expirationTime: json.expirationTime,
    }),
  });
  if (!res.ok) throw new Error(`Server push-subscribe failed: HTTP ${res.status}`);
}

export async function unsubscribeFromWebPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* ignore browser errors */
  }

  await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-unsubscribe`, {
    method: 'POST',
    credentials: 'include',
  });
}

export async function checkPushNotificationStatus(): Promise<{
  supported: boolean;
  permission: NotificationPermission | 'unknown';
  subscribed: boolean;
  serverEnabled: boolean;
}> {
  if (!isPushNotificationSupported()) {
    return { supported: false, permission: 'denied', subscribed: false, serverEnabled: false };
  }

  const permission = Notification.permission;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    let subscribed = false;
    if (registration) {
      const sub = await registration.pushManager.getSubscription();
      subscribed = !!sub;
    }
    return { supported: true, permission, subscribed, serverEnabled: subscribed };
  } catch {
    return { supported: true, permission, subscribed: false, serverEnabled: false };
  }
}
