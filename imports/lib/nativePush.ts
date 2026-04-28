/**
 * Platform-aware push notification module.
 *
 * - On a native Capacitor runtime (iOS / Android): uses @capacitor/push-notifications
 *   to request an APNs/FCM device token and POST it to the backend.
 * - On the web: delegates to the existing Web Push (VAPID) implementation.
 *
 * Usage: import { isPushSupported, subscribeToPush, unsubscribeFromPush } from './nativePush'
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

import { TIMECORE_BASE_URL } from './api';
import {
  checkPushNotificationStatus,
  isPushNotificationSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from './pushNotificationsClient';

export { checkPushNotificationStatus };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isPushSupported(): boolean {
  return Capacitor.isNativePlatform() || isPushNotificationSupported();
}

// ─── Subscribe ────────────────────────────────────────────────────────────────

export async function subscribeToPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return subscribeToWebPush();
  }

  // Native path: request permission, register, then wait for the device token.
  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== 'granted') {
    throw new Error('Notification permission denied');
  }

  await PushNotifications.register();

  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for push registration token'));
    }, 15_000);

    PushNotifications.addListener('registration', ({ value }) => {
      clearTimeout(timeout);
      resolve(value);
    });

    PushNotifications.addListener('registrationError', ({ error }) => {
      clearTimeout(timeout);
      reject(new Error(String(error)));
    });
  });

  const platform = Capacitor.getPlatform() as 'ios' | 'android';
  const res = await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'native', token, platform }),
  });

  if (!res.ok) throw new Error(`Server push-subscribe failed: HTTP ${res.status}`);
}

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

export async function unsubscribeFromPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return unsubscribeFromWebPush();
  }

  await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-unsubscribe`, {
    method: 'POST',
    credentials: 'include',
  });
}
