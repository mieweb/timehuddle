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

/**
 * Check if running on iOS simulator.
 * APNs does not work on iOS simulators - only real devices.
 */
async function isIOSSimulator(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'ios') return false;

  try {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getInfo();
    // On simulators, isVirtual is true
    return info.isVirtual === true;
  } catch {
    return false;
  }
}

export async function subscribeToPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return subscribeToWebPush();
  }

  // Check if running on iOS simulator
  const isSimulator = await isIOSSimulator();
  if (isSimulator) {
    throw new Error(
      'Push notifications do not work on iOS simulators. Please test on a real device.',
    );
  }

  // Native path: request permission, register, then wait for the device token.
  console.log('🔔 [nativePush] subscribeToPush: Checking permissions...');
  const { receive } = await PushNotifications.requestPermissions();
  console.log('🔔 [nativePush] subscribeToPush: Permission status:', receive);

  if (receive !== 'granted') {
    throw new Error('Notification permission denied');
  }

  console.log('🔔 [nativePush] subscribeToPush: Starting registration...');
  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('❌ [nativePush] subscribeToPush: Registration timed out after 30 seconds');
      console.error('❌ [nativePush] This usually means:');
      console.error('   1. No internet connection or APNs servers are blocked');
      console.error('   2. App is not properly signed with a push-enabled provisioning profile');
      console.error('   3. Push Notifications capability is not enabled in Xcode');
      reject(new Error('Timed out waiting for push registration token'));
    }, 30_000); // 30 second timeout

    let handles: Array<{ remove: () => void }> = [];
    const cleanup = () => {
      clearTimeout(timeout);
      handles.forEach((h) => h.remove());
    };

    Promise.all([
      PushNotifications.addListener('registration', ({ value }) => {
        console.log('✅ [nativePush] subscribeToPush: Registration successful');
        console.log('✅ [nativePush] Token received:', value.substring(0, 20) + '...');
        cleanup();
        resolve(value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        console.error('❌ [nativePush] subscribeToPush: Registration error:', error);
        cleanup();
        reject(new Error(String(error)));
      }),
    ])
      .then((hs) => {
        handles = hs;
        console.log('🔔 [nativePush] subscribeToPush: Calling PushNotifications.register()...');
        return PushNotifications.register();
      })
      .catch(reject);
  });

  const platform = Capacitor.getPlatform() as 'ios' | 'android';
  const token2 = localStorage.getItem('meteor_resume_token') || sessionToken.get();
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
  setNativePushRegistered(true);
}

// ─── Native registration state ─────────────────────────────────────────────

const PUSH_REGISTERED_KEY = 'timehuddle_push_registered_v1';

/** Returns true if a token was successfully sent to the backend on this device. */
export function isNativePushRegistered(): boolean {
  return localStorage.getItem(PUSH_REGISTERED_KEY) === '1';
}

function setNativePushRegistered(value: boolean): void {
  if (value) {
    localStorage.setItem(PUSH_REGISTERED_KEY, '1');
  } else {
    localStorage.removeItem(PUSH_REGISTERED_KEY);
  }
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
export async function autoRegisterPush(userId: string): Promise<void> {
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
  console.log('🔔 [nativePush] Starting web push registration for user:', userId);

  if (!isPushNotificationSupported()) {
    console.warn('🔔 [nativePush] Push notifications not supported in this browser');
    return;
  }

  const vapidKey =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
    '';
  if (!vapidKey) {
    console.warn('🔔 [nativePush] VITE_VAPID_PUBLIC_KEY not configured');
    return;
  }
  console.log('🔔 [nativePush] VAPID key configured:', vapidKey.substring(0, 20) + '...');

  try {
    const permission = Notification.permission;
    console.log('🔔 [nativePush] Current permission:', permission);

    if (permission === 'granted') {
      // Check if there's already an active subscription — if so, nothing to do.
      console.log('🔔 [nativePush] Permission granted, checking existing subscription...');
      const status = await checkPushNotificationStatus();
      console.log('🔔 [nativePush] Push status:', status);

      if (status.subscribed) {
        console.log('✅ [nativePush] Already subscribed to web push');
        return;
      }
      // No active subscription (e.g. SW was cleared) — re-subscribe silently.
      console.log('🔔 [nativePush] No active subscription, subscribing now...');
      await subscribeToWebPush();
      console.log('✅ [nativePush] Successfully subscribed to web push');
      return;
    }

    if (permission === 'denied') {
      console.warn('🔔 [nativePush] Notification permission denied by user');
      return;
    }

    // 'default': prompt once per user
    const promptedKey = `${PUSH_PROMPTED_KEY}:${userId}`;
    const alreadyPrompted = localStorage.getItem(promptedKey) === '1';
    console.log('🔔 [nativePush] Already prompted for this user:', alreadyPrompted);

    if (alreadyPrompted) {
      console.log('🔔 [nativePush] User was already prompted, skipping');
      return;
    }

    console.log('🔔 [nativePush] Requesting notification permission...');
    localStorage.setItem(promptedKey, '1');
    const granted = await Notification.requestPermission();
    console.log('🔔 [nativePush] Permission result:', granted);

    if (granted !== 'granted') return;

    console.log('🔔 [nativePush] Subscribing to web push...');
    await subscribeToWebPush();
    console.log('✅ [nativePush] Successfully subscribed to web push');
  } catch (err) {
    console.error('❌ [nativePush] autoRegisterWeb failed:', err);
  }
}

async function _registerAndSaveToken(): Promise<void> {
  console.log('🔔 [nativePush] Starting native push registration...');

  // Check if running on iOS simulator
  const isSimulator = await isIOSSimulator();
  if (isSimulator) {
    console.warn('⚠️ [nativePush] Skipping push registration on iOS simulator');
    return;
  }

  const token = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('❌ [nativePush] Registration timed out after 30 seconds');
      console.error('❌ [nativePush] This usually means:');
      console.error('   1. No internet connection or APNs servers are blocked');
      console.error('   2. App is not properly signed with a push-enabled provisioning profile');
      console.error('   3. Push Notifications capability is not enabled in Xcode');
      reject(new Error('Timed out waiting for push token'));
    }, 30_000); // 30 second timeout

    let handles: Array<{ remove: () => void }> = [];
    const cleanup = () => {
      clearTimeout(timeout);
      handles.forEach((h) => h.remove()); // ← only removes registration listeners
    };

    Promise.all([
      PushNotifications.addListener('registration', ({ value }) => {
        console.log('✅ [nativePush] Registration successful, token received');
        console.log('✅ [nativePush] Token:', value.substring(0, 20) + '...');
        cleanup();
        resolve(value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        console.error('❌ [nativePush] Registration error:', error);
        cleanup();
        reject(new Error(String(error)));
      }),
    ])
      .then((hs) => {
        handles = hs;
        console.log('🔔 [nativePush] Calling PushNotifications.register()...');
        return PushNotifications.register();
      })
      .catch(reject);
  });

  const platform = Capacitor.getPlatform() as 'ios' | 'android';
  const authToken = localStorage.getItem('meteor_resume_token') || sessionToken.get();
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
    setNativePushRegistered(true);
  }
}

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

export async function unsubscribeFromPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return unsubscribeFromWebPush();
  }

  const token3 = localStorage.getItem('meteor_resume_token') || sessionToken.get();
  await fetch(`${TIMECORE_BASE_URL}/v1/notifications/push-unsubscribe`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...(token3 ? { Authorization: `Bearer ${token3}` } : {}) },
  });
  setNativePushRegistered(false);
}
