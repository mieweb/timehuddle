/**
 * Web Push + FCM — server-side sending and subscription storage (timeharbor-old parity).
 * Imported only from server/main.ts so this module never loads on the client.
 */
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { Meteor } from 'meteor/meteor';
import webpush from 'web-push';

import { Notifications, Teams } from '../features/teams/api';

export const PUSH_ICON = '/timehuddle-icon.svg';
export const APP_NAME_PUSH = 'TimeHuddle';

const vapidKeys = {
  publicKey:
    (Meteor.settings as { private?: { VAPID_PUBLIC_KEY?: string }; public?: { vapidPublicKey?: string } })?.private
      ?.VAPID_PUBLIC_KEY ?? (Meteor.settings as { public?: { vapidPublicKey?: string } })?.public?.vapidPublicKey,
  privateKey: (Meteor.settings as { private?: { VAPID_PRIVATE_KEY?: string } })?.private?.VAPID_PRIVATE_KEY,
};

const vapidContact =
  ((Meteor.settings as { private?: { VAPID_CONTACT_EMAIL?: string } })?.private?.VAPID_CONTACT_EMAIL as string) ||
  'mailto:support@example.com';

if (vapidKeys.publicKey && vapidKeys.privateKey) {
  webpush.setVapidDetails(vapidContact, vapidKeys.publicKey, vapidKeys.privateKey);
} else {
  console.warn('[Push] VAPID keys not configured — Web Push disabled until settings are set.');
}

// ─── Firebase Admin (FCM) — lazy ─────────────────────────────────────────────

let firebaseAdmin: typeof import('firebase-admin') | null = null;
let fcmMessaging: import('firebase-admin/messaging').Messaging | null = null;

function getFirebaseAdmin(): {
  admin: typeof import('firebase-admin') | null;
  messaging: import('firebase-admin/messaging').Messaging | null;
} {
  if (!firebaseAdmin) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const adminSdk = require('firebase-admin') as typeof import('firebase-admin');
      firebaseAdmin = adminSdk;
      const appName = 'TimeHuddlePush';

      let serviceAccount = (Meteor.settings as { private?: { service_account?: Record<string, unknown> } })?.private
        ?.service_account as Record<string, unknown> | undefined;

      if (!serviceAccount) {
        const priv = (Meteor.settings as { private?: Record<string, unknown> })?.private ?? {};
        serviceAccount = {
          projectId: priv.project_id ?? priv.FCM_PROJECT_ID,
          privateKey: priv.private_key ?? priv.FCM_PRIVATE_KEY,
          clientEmail: priv.client_email ?? priv.FCM_CLIENT_EMAIL,
        };
      }

      const privateKeyRaw = (serviceAccount?.privateKey ?? serviceAccount?.private_key) as string | undefined;
      if (privateKeyRaw) {
        const validPrivateKey = privateKeyRaw.replace(/\\n/g, '\n');
        serviceAccount = { ...serviceAccount, privateKey: validPrivateKey, private_key: validPrivateKey };
      }

      const projectId = (serviceAccount?.projectId ?? serviceAccount?.project_id) as string | undefined;
      const clientEmail = (serviceAccount?.clientEmail ?? serviceAccount?.client_email) as string | undefined;
      const privateKey = (serviceAccount?.privateKey ?? serviceAccount?.private_key) as string | undefined;

      const existingApp = adminSdk.apps.find((a) => a && a.name === appName);

      if (existingApp) {
        fcmMessaging = existingApp.messaging();
      } else if (projectId && privateKey && clientEmail) {
        const app = adminSdk.initializeApp(
          { credential: adminSdk.credential.cert(serviceAccount as never) },
          appName,
        );
        fcmMessaging = app.messaging();
        console.log('[Push] Firebase Admin initialized');
      } else {
        console.warn('[Push] FCM credentials not found — native mobile push via FCM disabled.');
      }
    } catch (e) {
      console.error('[Push] Firebase Admin init error:', e);
    }
  }
  return { admin: firebaseAdmin, messaging: fcmMessaging };
}

// ─── Payload shape (matches public/sw.js) ───────────────────────────────────

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  image?: string;
  data?: Record<string, unknown>;
}

interface StoredPushSubscription {
  type?: string;
  token?: string;
  platform?: string;
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

async function sendFcmNotification(token: string, payload: PushNotificationPayload) {
  const { messaging } = getFirebaseAdmin();
  if (!messaging) return { success: false as const, error: 'FCM not initialized' };

  try {
    const dataFlat: Record<string, string> = {
      title: payload.title || '',
      body: payload.body || '',
      ...(Object.keys(payload.data || {}).reduce<Record<string, string>>((acc, key) => {
        const value = payload.data![key];
        acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return acc;
      }, {}) as Record<string, string>),
    };

    const message = {
      token,
      notification: {
        title: payload.title || APP_NAME_PUSH,
        body: payload.body || '',
      },
      data: dataFlat,
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'default',
          icon: 'ic_launcher',
          color: '#4285F4',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await messaging.send(message);
    return { success: true as const, messageId: response };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    console.error('[Push] FCM send error:', error);
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      return { success: false as const, expired: true as const, error: err.message };
    }
    return { success: false as const, error: err.message ?? 'FCM error' };
  }
}

async function sendWebPushNotification(subscription: StoredPushSubscription, payload: PushNotificationPayload) {
  const { type: _t, ...rest } = subscription;
  try {
    await webpush.sendNotification(rest as webpush.PushSubscription, JSON.stringify(payload));
    return { success: true as const };
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string };
    console.error('[Push] Web Push send error:', error);
    if (err.statusCode === 410) return { success: false as const, expired: true as const };
    return { success: false as const, error: err.message };
  }
}

export async function sendPushNotification(
  subscription: StoredPushSubscription,
  payload: PushNotificationPayload,
): Promise<{ success: boolean; expired?: boolean; error?: string; messageId?: string }> {
  try {
    const subscriptionType = subscription.type || 'webpush';
    if (subscriptionType === 'fcm') {
      if (!subscription.token) return { success: false, error: 'Missing FCM token' };
      return await sendFcmNotification(subscription.token, payload);
    }
    return await sendWebPushNotification(subscription, payload);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[Push] sendPushNotification:', error);
    return { success: false, error: err.message };
  }
}

export async function saveNotificationsToInbox(teamId: string, notificationData: PushNotificationPayload) {
  const team = await Teams.findOneAsync(teamId);
  if (!team) return;
  const adminIds = [...new Set([...(team.admins || [])])];
  const now = new Date();
  if (adminIds.length === 0) return;

  await Promise.all(
    adminIds.map((userId) =>
      Notifications.insertAsync({
        userId,
        title: notificationData.title || APP_NAME_PUSH,
        body: notificationData.body || '',
        data: (notificationData.data || {}) as Record<string, unknown>,
        read: false,
        createdAt: now,
      }),
    ),
  );
}

export async function notifyTeamAdmins(teamId: string, notificationData: PushNotificationPayload) {
  try {
    const team = await Teams.findOneAsync(teamId);
    if (!team) return;

    await saveNotificationsToInbox(teamId, notificationData);

    const adminIds = [...new Set([...(team.admins || [])])];
    const users = await Meteor.users
      .find({
        _id: { $in: adminIds },
        'profile.pushSubscription': { $exists: true },
      })
      .fetchAsync();

    const results = [];
    for (const user of users) {
      const profile = user.profile as Record<string, unknown> | undefined;
      const sub = profile?.pushSubscription as StoredPushSubscription | undefined;
      if (!sub) continue;
      const result = await sendPushNotification(sub, notificationData);
      if (result.expired) {
        await Meteor.users.updateAsync(user._id!, {
          $unset: { 'profile.pushSubscription': '', 'profile.pushSubscribedAt': '' },
        });
      }
      results.push({ userId: user._id, ...result });
    }
    return results;
  } catch (error) {
    console.error('[Push] notifyTeamAdmins:', error);
    throw error;
  }
}

export async function notifyUser(userId: string, notificationData: PushNotificationPayload) {
  try {
    const user = await Meteor.users.findOneAsync(userId);
    const profile = user?.profile as Record<string, unknown> | undefined;
    if (!profile?.pushSubscription) {
      return { success: false as const, reason: 'User not found or no subscription' };
    }
    const sub = profile.pushSubscription as StoredPushSubscription;
    const result = await sendPushNotification(sub, notificationData);
    if (result.expired) {
      await Meteor.users.updateAsync(userId, {
        $unset: { 'profile.pushSubscription': '', 'profile.pushSubscribedAt': '' },
      });
    }
    return { userId, ...result };
  } catch (error) {
    console.error('[Push] notifyUser:', error);
    throw error;
  }
}

export function getVapidPublicKey(): string | undefined {
  return vapidKeys.publicKey;
}

Meteor.startup(() => {
  const pushMethods = [
    'getVapidPublicKey',
    'getFcmSenderId',
    'subscribeToPushNotifications',
    'unsubscribeFromPushNotifications',
    'checkPushNotificationStatus',
  ];
  DDPRateLimiter.addRule({ name: (n) => pushMethods.includes(n), userId: () => true }, 40, 60_000);
});

Meteor.methods({
  getVapidPublicKey() {
    const key = getVapidPublicKey();
    if (!key) throw new Meteor.Error('not-configured', 'Web Push is not configured on this server');
    return key;
  },

  getFcmSenderId() {
    return (Meteor.settings as { public?: { fcmSenderId?: string } })?.public?.fcmSenderId;
  },

  async subscribeToPushNotifications(subscription: unknown) {
    if (!this.userId) throw new Meteor.Error('not-authorized');
    if (!subscription || typeof subscription !== 'object') {
      throw new Meteor.Error('validation', 'Invalid subscription');
    }
    const sub = subscription as Record<string, unknown>;
    const subscriptionType = (sub.type as string) || 'webpush';

    try {
      if (subscriptionType === 'fcm') {
        await Meteor.users.updateAsync(this.userId, {
          $set: {
            'profile.pushSubscription': {
              type: 'fcm',
              token: sub.token,
              platform: sub.platform || 'android',
            },
            'profile.pushSubscribedAt': new Date(),
          },
        });
      } else {
        await Meteor.users.updateAsync(this.userId, {
          $set: {
            'profile.pushSubscription': {
              type: 'webpush',
              endpoint: sub.endpoint,
              keys: sub.keys,
              expirationTime: sub.expirationTime ?? null,
            },
            'profile.pushSubscribedAt': new Date(),
          },
        });
      }
      return { success: true as const };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('[Push] subscribe error:', error);
      throw new Meteor.Error('subscription-failed', err.message || 'Failed to subscribe');
    }
  },

  async unsubscribeFromPushNotifications() {
    if (!this.userId) throw new Meteor.Error('not-authorized');
    await Meteor.users.updateAsync(this.userId, {
      $unset: { 'profile.pushSubscription': '', 'profile.pushSubscribedAt': '' },
    });
    return { success: true as const };
  },

  async checkPushNotificationStatus() {
    if (!this.userId) return { enabled: false as const };
    const user = await Meteor.users.findOneAsync(this.userId, { fields: { 'profile.pushSubscription': 1 } });
    const p = user?.profile as Record<string, unknown> | undefined;
    return { enabled: !!p?.pushSubscription };
  },
});
