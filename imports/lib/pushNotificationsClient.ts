/**
 * Browser Web Push client — parity with timeharbor-old NotificationUtils (web path).
 * Cordova / FCM native is not wired in this app; use the same Meteor methods if you add a shell later.
 */
import { Meteor } from 'meteor/meteor';

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

/** Register /sw.js (matches timeharbor-old: replace existing registrations first). */
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

  const permissionGranted = await requestNotificationPermission();
  if (!permissionGranted) throw new Error('Notification permission denied');

  const registration = await registerServiceWorker();
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  const vapidPublicKey = await new Promise<string>((resolve, reject) => {
    Meteor.call('getVapidPublicKey', (err: Meteor.Error | undefined, key: string) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  let subscription = await registration.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();

  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const json = subscription.toJSON();
  await new Promise<void>((resolve, reject) => {
    Meteor.call(
      'subscribeToPushNotifications',
      {
        type: 'webpush',
        endpoint: json.endpoint,
        keys: json.keys,
        expirationTime: json.expirationTime,
      },
      (err: Meteor.Error | undefined) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

export async function unsubscribeFromWebPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve, reject) => {
    Meteor.call('unsubscribeFromPushNotifications', (err: Meteor.Error | undefined) => {
      if (err) reject(err);
      else resolve();
    });
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

  const serverEnabled = await new Promise<boolean>((resolve) => {
    Meteor.call('checkPushNotificationStatus', (err: Meteor.Error | undefined, result?: { enabled?: boolean }) => {
      if (err) resolve(false);
      else resolve(!!result?.enabled);
    });
  });

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    let subscribed = false;
    if (registration) {
      const sub = await registration.pushManager.getSubscription();
      subscribed = !!sub;
    }
    return { supported: true, permission, subscribed, serverEnabled };
  } catch {
    return { supported: true, permission, subscribed: false, serverEnabled };
  }
}
