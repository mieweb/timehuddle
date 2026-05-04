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

import { TIMECORE_BASE_URL, sessionToken } from './api';
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

  const token = await new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for push registration token'));
    }, 15_000);

    const successHandle = await PushNotifications.addListener('registration', ({ value }) => {
      clearTimeout(timeout);
      successHandle.remove();
      errorHandle.remove();
      resolve(value);
    });

    const errorHandle = await PushNotifications.addListener('registrationError', ({ error }) => {
      clearTimeout(timeout);
      successHandle.remove();
      errorHandle.remove();
      reject(new Error(String(error)));
    });

    await PushNotifications.register();
  });

  const platform = Capacitor.getPlatform() as 'ios' | 'android';
  const token2 = sessionToken.get();
  const res = await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token2 ? { Authorization: `Bearer ${token2}` } : {}),
    },
    body: JSON.stringify({ type: 'native', token, platform }),
  });

  if (!res.ok) throw new Error(`Server push-subscribe failed: HTTP ${res.status}`);
}

// ─── Auto-register on startup ────────────────────────────────────────────────

const PUSH_PROMPTED_KEY = 'timehuddle_push_prompted_v1';

/**
 * Call once after login on native platforms.
 * - If permission already granted: silently re-register (handles token refresh).
 * - If not yet asked: request once, then silently register.
 * - If denied: do nothing.
 */
export async function autoRegisterNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { receive } = await PushNotifications.checkPermissions();

    if (receive === 'granted') {
      // Already allowed — silently re-register to refresh token
      await _registerAndSaveToken();
      return;
    }

    if (receive === 'denied') return;

    // 'prompt' or 'prompt-with-rationale': ask once
    const alreadyPrompted = localStorage.getItem(PUSH_PROMPTED_KEY) === '1';
    if (alreadyPrompted) return;

    localStorage.setItem(PUSH_PROMPTED_KEY, '1');
    const { receive: granted } = await PushNotifications.requestPermissions();
    if (granted !== 'granted') return;

    await _registerAndSaveToken();
  } catch (err) {
    console.warn('[nativePush] autoRegister failed:', err);
  }
}

async function _registerAndSaveToken(): Promise<void> {
  const token = await new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for push token')),
      15_000,
    );
    const successHandle = await PushNotifications.addListener('registration', ({ value }) => {
      clearTimeout(timeout);
      successHandle.remove();
      errorHandle.remove();
      resolve(value);
    });
    const errorHandle = await PushNotifications.addListener('registrationError', ({ error }) => {
      clearTimeout(timeout);
      successHandle.remove();
      errorHandle.remove();
      reject(new Error(String(error)));
    });
    await PushNotifications.register();
  });

  const platform = Capacitor.getPlatform() as 'ios' | 'android';
  const authToken = sessionToken.get();
  const res = await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-subscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ type: 'native', token, platform }),
  });

  if (!res.ok) {
    console.warn(`[nativePush] push-subscribe failed: HTTP ${res.status}`);
  } else {
    console.log('[nativePush] FCM token saved ok');
  }
}

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

export async function unsubscribeFromPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return unsubscribeFromWebPush();
  }

  const token3 = sessionToken.get();
  await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-unsubscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...(token3 ? { Authorization: `Bearer ${token3}` } : {}) },
  });
}
