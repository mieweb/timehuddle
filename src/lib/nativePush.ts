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

  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for push registration token'));
    }, 15_000);

    let handles: Array<{ remove: () => void }> = [];
    const cleanup = () => {
      clearTimeout(timeout);
      handles.forEach((h) => h.remove());
    };

    Promise.all([
      PushNotifications.addListener('registration', ({ value }) => {
        cleanup();
        resolve(value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        cleanup();
        reject(new Error(String(error)));
      }),
    ])
      .then((hs) => {
        handles = hs;
        return PushNotifications.register();
      })
      .catch(reject);
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
 * Call once after login on any platform.
 * - Native (iOS/Android): uses APNs/FCM device token via Capacitor.
 * - Web: uses VAPID Web Push — same prompt-once-per-user behaviour.
 *
 * For both paths:
 * - Permission already granted → silently re-register (handles token refresh).
 * - Not yet asked → prompt once per user, then register.
 * - Denied → do nothing.
 *
 * @param userId The signed-in user's ID — the prompted flag is scoped per-user
 *   so each account on a shared device gets its own opt-in chance.
 */
export async function autoRegisterNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await _autoRegisterWeb(userId);
    return;
  }

  try {
    const { receive } = await PushNotifications.checkPermissions();

    if (receive === 'granted') {
      // Already allowed — silently re-register to refresh token
      await _registerAndSaveToken();
      return;
    }

    if (receive === 'denied') return;

    // 'prompt' or 'prompt-with-rationale': ask once per user
    const promptedKey = `${PUSH_PROMPTED_KEY}:${userId}`;
    const alreadyPrompted = localStorage.getItem(promptedKey) === '1';
    if (alreadyPrompted) return;

    localStorage.setItem(promptedKey, '1');
    const { receive: granted } = await PushNotifications.requestPermissions();
    if (granted !== 'granted') return;

    await _registerAndSaveToken();
  } catch (err) {
    console.warn('[nativePush] autoRegister failed:', err);
  }
}

async function _autoRegisterWeb(userId: string): Promise<void> {
  if (!isPushNotificationSupported()) return;

  const vapidKey =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
    '';
  if (!vapidKey) return;

  try {
    const permission = Notification.permission;

    if (permission === 'granted') {
      // Check if there's already an active subscription — if so, nothing to do.
      const status = await checkPushNotificationStatus();
      if (status.subscribed) return;
      // No active subscription (e.g. SW was cleared) — re-subscribe silently.
      await subscribeToWebPush();
      return;
    }

    if (permission === 'denied') return;

    // 'default': prompt once per user
    const promptedKey = `${PUSH_PROMPTED_KEY}:${userId}`;
    const alreadyPrompted = localStorage.getItem(promptedKey) === '1';
    if (alreadyPrompted) return;

    localStorage.setItem(promptedKey, '1');
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') return;

    await subscribeToWebPush();
  } catch (err) {
    console.warn('[nativePush] autoRegisterWeb failed:', err);
  }
}

async function _registerAndSaveToken(): Promise<void> {
  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for push token')), 15_000);

    let handles: Array<{ remove: () => void }> = [];
    const cleanup = () => {
      clearTimeout(timeout);
      handles.forEach((h) => h.remove());
    };

    Promise.all([
      PushNotifications.addListener('registration', ({ value }) => {
        cleanup();
        resolve(value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        cleanup();
        reject(new Error(String(error)));
      }),
    ])
      .then((hs) => {
        handles = hs;
        return PushNotifications.register();
      })
      .catch(reject);
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
