/**
 * Push — port of backend/src/services/push.service.ts.
 *
 * Sends notifications to a user's devices across three transports:
 *   iOS device tokens     → APNs (@parse/node-apn)
 *   Android device tokens → FCM (firebase-admin)
 *   Web push subscriptions → VAPID (web-push)
 *
 * Reads the SAME `pushsubscriptions` / `devicetokens` collections and the same
 * env vars (VAPID_*, APNS_*, FIREBASE_SERVICE_ACCOUNT) as the Fastify backend,
 * so either backend can deliver pushes against shared Mongo. Native driver only
 * (no reactivity needed) — plain async functions, no Meteor types.
 */
import { MongoInternals } from 'meteor/mongo';
import webpush from 'web-push';
import apn from '@parse/node-apn';
// Meteor's bundler does not honor firebase-admin's `exports` map, so the public
// subpaths (firebase-admin/app, firebase-admin/messaging) fail to resolve. The
// root entry exposes the app lifecycle API (initializeApp/getApps/cert); the
// messaging API is pulled from its concrete file path instead.
import { initializeApp, getApps, cert } from 'firebase-admin';
import { getMessaging } from 'firebase-admin/lib/messaging';
import { rawDb } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function pushSubscriptions() {
  return rawDb().collection('pushsubscriptions');
}
function deviceTokens() {
  return rawDb().collection('devicetokens');
}

// ─── APNs init ────────────────────────────────────────────────────────────────

let apnsProvider = null;

function ensureApns() {
  if (apnsProvider) return apnsProvider;
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) {
    console.warn('[push] APNs not configured — set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID');
    return null;
  }
  try {
    apnsProvider = new apn.Provider({
      token: { key: Buffer.from(key, 'base64').toString('utf8'), keyId, teamId },
      production: process.env.APNS_PRODUCTION === 'true',
    });
    console.log('[push] APNs provider initialized ok');
    return apnsProvider;
  } catch (err) {
    console.warn('[push] APNs init failed:', err.message);
    return null;
  }
}

// ─── FCM init ────────────────────────────────────────────────────────────────

let _fcmInitPromise = null;

function ensureFcm() {
  if (!_fcmInitPromise) _fcmInitPromise = _initFcm();
  return _fcmInitPromise;
}

async function _initFcm() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!encoded) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT not set — Android FCM disabled');
    return false;
  }
  if (getApps().length > 0) return true;
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    initializeApp({ credential: cert(json) });
    console.log('[push] Firebase Admin initialized ok');
    return true;
  } catch (err) {
    console.warn('[push] Firebase Admin init failed:', err.message);
    _fcmInitPromise = null;
    return false;
  }
}

// ─── VAPID init ───────────────────────────────────────────────────────────────

let vapidInitialized = false;

function ensureVapid() {
  if (vapidInitialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@timehuddle.app';
  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID keys not configured — web push disabled');
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidInitialized = true;
  console.log('[push] VAPID initialized ok');
}

// ─── Senders ──────────────────────────────────────────────────────────────────

/** Remove a specific device token for a user (stale-token cleanup). */
async function removeDeviceToken(userId, token) {
  await deviceTokens().updateOne({ userId }, { $pull: { tokens: { token } } });
}

async function sendFcm(userId, token, payload) {
  if (!(await ensureFcm())) return;
  try {
    console.log(`[push] sending FCM to token ${token.slice(0, 16)}…`);
    await getMessaging().send({
      token,
      notification: { title: payload.title, body: payload.body },
      android: { notification: { sound: 'default', ...(payload.tag ? { tag: payload.tag } : {}) } },
      data: payload.data
        ? Object.fromEntries(Object.entries(payload.data).map(([k, v]) => [k, String(v)]))
        : undefined,
    });
    console.log('[push] FCM sent ok');
  } catch (err) {
    const code = err?.errorInfo?.code ?? err?.code ?? '';
    console.error(`[push] FCM error code=${code} message=${err.message}`);
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token'
    ) {
      await removeDeviceToken(userId, token);
      console.log('[push] removed stale FCM token');
    }
  }
}

async function sendApns(provider, userId, token, payload) {
  if (!provider) {
    console.warn('[push] APNs provider not available — skipping');
    return;
  }
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!bundleId) {
    console.warn('[push] APNS_BUNDLE_ID not set — skipping');
    return;
  }
  const note = new apn.Notification();
  note.topic = bundleId;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = 'default';
  note.badge = 1;
  if (payload.tag) note.collapseId = payload.tag.slice(0, 64);
  if (payload.data) note.payload = payload.data;

  try {
    console.log(`[push] sending APNs to token ${token.slice(0, 16)}…`);
    const result = await provider.send(note, token);
    if (result.failed.length > 0) {
      const failure = result.failed[0];
      const reason = failure?.response?.reason ?? 'unknown';
      console.error(`[push] APNs failed reason=${reason} token=${token.slice(0, 16)}…`);
      if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
        await removeDeviceToken(userId, token);
        console.log('[push] removed stale APNs token');
      }
    } else {
      console.log('[push] APNs sent ok');
    }
  } catch (err) {
    console.error('[push] APNs send error:', err.message);
  }
}

async function sendWebPush(sub, payloadStr) {
  if (!sub.endpoint || !sub.keys) {
    console.log(`[push] skip webpush sub ${sub._id} — missing endpoint or keys`);
    return;
  }
  try {
    console.log(`[push] sending webpush to ${sub.endpoint.slice(0, 60)}…`);
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        ...(sub.expirationTime != null ? { expirationTime: sub.expirationTime } : {}),
      },
      payloadStr
    );
    console.log('[push] webpush sent ok');
  } catch (err) {
    console.error(
      `[push] webpush error statusCode=${err?.statusCode} body=${err?.body} message=${err?.message}`
    );
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      await pushSubscriptions().deleteOne({ _id: sub._id });
    }
  }
}

/**
 * Send a push notification to all of a user's devices (iOS APNs, Android FCM,
 * web VAPID). Mirrors PushService.sendToUser — best-effort, never throws.
 */
export async function sendToUser(userId, payload) {
  ensureVapid();
  const provider = ensureApns();

  const [deviceDoc, webSubs] = await Promise.all([
    deviceTokens().findOne({ userId }),
    pushSubscriptions().find({ userId, type: 'webpush' }).toArray(),
  ]);

  const tokens = deviceDoc?.tokens ?? [];
  const totalTargets = tokens.length + webSubs.length;
  console.log(
    `[push] sendToUser userId=${userId} native=${tokens.length} web=${webSubs.length} title="${payload.title}"`
  );
  if (totalTargets === 0) return;

  const tasks = [];
  for (const entry of tokens) {
    if (entry.platform === 'ios') {
      tasks.push(sendApns(provider, userId, entry.token, payload));
    } else if (entry.platform === 'android') {
      tasks.push(sendFcm(userId, entry.token, payload));
    }
  }

  const payloadStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    data: payload.data ?? {},
  });
  for (const sub of webSubs) {
    tasks.push(sendWebPush(sub, payloadStr));
  }

  await Promise.allSettled(tasks);
}

export const pushService = { sendToUser };
