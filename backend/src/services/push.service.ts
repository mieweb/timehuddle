import webpush from "web-push";
import apn from "@parse/node-apn";
import { ObjectId } from "mongodb";
import { pushSubscriptionsCollection, deviceTokensCollection } from "../models/index.js";
import type { PushSubscription } from "../models/push-subscription.model.js";

// ─── APNs init ────────────────────────────────────────────────────────────────

let apnsProvider: apn.Provider | null = null;

function ensureApns(): apn.Provider | null {
  if (apnsProvider) return apnsProvider;
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) {
    console.warn("[push] APNs not configured — set APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID");
    return null;
  }
  try {
    apnsProvider = new apn.Provider({
      token: {
        key: Buffer.from(key, "base64").toString("utf8"),
        keyId,
        teamId,
      },
      production: process.env.APNS_PRODUCTION === "true",
    });
    console.log("[push] APNs provider initialized ok");
    return apnsProvider;
  } catch (err: any) {
    console.warn("[push] APNs init failed:", err.message);
    return null;
  }
}

// ─── VAPID init ───────────────────────────────────────────────────────────────

let vapidInitialized = false;

function ensureVapid() {
  if (vapidInitialized) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@timehuddle.app";
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not configured — web push disabled");
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidInitialized = true;
  console.log("[push] VAPID initialized ok");
}

// ─── Push payload ─────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class PushService {
  /**
   * Upsert a device token for a user.
   * - Removes the token from any other user first (handles device account switching).
   * - Uses a single atomic `updateOne` with `$addToSet` + `arrayFilters` to avoid
   *   duplicate entries under concurrent registration calls.
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    platform: "ios" | "android"
  ): Promise<void> {
    const now = new Date();
    const col = deviceTokensCollection();

    // Remove this token from any other user's document (device account-switch safety).
    await col.updateMany(
      { userId: { $ne: userId }, "tokens.token": token },
      { $pull: { tokens: { token } } }
    );

    // Atomically refresh if already present, otherwise append — one round-trip.
    const result = await col.updateOne(
      { userId, "tokens.token": token },
      { $set: { "tokens.$[entry].updatedAt": now, "tokens.$[entry].platform": platform } },
      { arrayFilters: [{ "entry.token": token }] }
    );

    if (result.matchedCount === 0) {
      // Token not yet in the array — append it atomically (upsert creates doc if needed).
      await col.updateOne(
        { userId },
        {
          $push: { tokens: { token, platform, updatedAt: now } },
          $setOnInsert: { _id: new ObjectId() },
        },
        { upsert: true }
      );
    }
  }

  /** Remove a specific device token for a user (e.g. on logout or stale token). */
  async removeDeviceToken(userId: string, token: string): Promise<void> {
    await deviceTokensCollection().updateOne({ userId }, { $pull: { tokens: { token } } });
  }

  /** Replace all web push (VAPID) subscriptions for a user with the new one. */
  async saveWebPush(
    userId: string,
    sub: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      expirationTime?: number | null;
    }
  ): Promise<void> {
    const now = new Date();
    const col = pushSubscriptionsCollection();

    // Remove this endpoint from any other user first (browser account-switch safety).
    await col.deleteMany({ userId: { $ne: userId }, type: "webpush", endpoint: sub.endpoint });

    // Replace all previous web subscriptions for this user with the new endpoint.
    // Each call to subscribeToWebPush() creates a new browser endpoint — keeping
    // stale ones causes batches of 410 errors on every push send.
    await col.deleteMany({ userId, type: "webpush", endpoint: { $ne: sub.endpoint } });

    await col.updateOne(
      { userId, type: "webpush", endpoint: sub.endpoint },
      {
        $set: {
          userId,
          type: "webpush" as const,
          endpoint: sub.endpoint,
          keys: sub.keys,
          expirationTime: sub.expirationTime ?? null,
          updatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), createdAt: now },
      },
      { upsert: true }
    );
  }

  /** Remove all push subscriptions and device tokens for a user. */
  async removeAll(userId: string): Promise<void> {
    await Promise.all([
      pushSubscriptionsCollection().deleteMany({ userId }),
      deviceTokensCollection().deleteOne({ userId }),
    ]);
  }

  /**
   * Send a push notification to all of a user's devices.
   * - iOS device tokens → APNs directly
   * - Android device tokens → not yet implemented (logged, skipped)
   * - Web push subscriptions → VAPID
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    ensureVapid();
    const provider = ensureApns();

    const [deviceDoc, webSubs] = await Promise.all([
      deviceTokensCollection().findOne({ userId }),
      pushSubscriptionsCollection().find({ userId, type: "webpush" }).toArray(),
    ]);

    const tokens = deviceDoc?.tokens ?? [];
    const totalTargets = tokens.length + webSubs.length;
    console.log(
      `[push] sendToUser userId=${userId} native=${tokens.length} web=${webSubs.length} title="${payload.title}"`
    );
    if (totalTargets === 0) return;

    const tasks: Promise<void>[] = [];

    for (const entry of tokens) {
      if (entry.platform === "ios") {
        tasks.push(this._sendApns(provider, userId, entry.token, payload));
      } else {
        console.warn(
          `[push] Android push not yet implemented — skipping token ${entry.token.slice(0, 16)}…`
        );
      }
    }

    const payloadStr = JSON.stringify({
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      data: payload.data ?? {},
    });
    for (const sub of webSubs) {
      tasks.push(this._sendWebPush(sub, payloadStr));
    }

    await Promise.allSettled(tasks);
  }

  /** @deprecated Use sendToUser — kept for backwards compat with existing call sites. */
  async sendPush(userId: string, payload: PushPayload): Promise<void> {
    return this.sendToUser(userId, payload);
  }

  private async _sendApns(
    provider: apn.Provider | null,
    userId: string,
    token: string,
    payload: PushPayload
  ): Promise<void> {
    if (!provider) {
      console.warn("[push] APNs provider not available — skipping");
      return;
    }
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!bundleId) {
      console.warn("[push] APNS_BUNDLE_ID not set — skipping");
      return;
    }
    const note = new apn.Notification();
    note.topic = bundleId;
    note.alert = { title: payload.title, body: payload.body };
    note.sound = "default";
    note.badge = 1;
    // APNs collapseId has a 64-byte max — truncate silently if needed
    if (payload.tag) note.collapseId = payload.tag.slice(0, 64);
    if (payload.data) note.payload = payload.data;

    try {
      console.log(`[push] sending APNs to token ${token.slice(0, 16)}…`);
      const result = await provider.send(note, token);
      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const reason = (failure as any)?.response?.reason ?? "unknown";
        console.error(`[push] APNs failed reason=${reason} token=${token.slice(0, 16)}…`);
        // Stale token — remove from the array
        if (reason === "BadDeviceToken" || reason === "Unregistered") {
          await this.removeDeviceToken(userId, token);
          console.log("[push] removed stale APNs token");
        }
      } else {
        console.log("[push] APNs sent ok");
      }
    } catch (err: any) {
      console.error("[push] APNs send error:", err.message);
    }
  }

  private async _sendWebPush(sub: PushSubscription, payloadStr: string): Promise<void> {
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
      console.log("[push] webpush sent ok");
    } catch (err: any) {
      console.error(
        `[push] webpush error statusCode=${err?.statusCode} body=${err?.body} message=${err?.message}`
      );
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await pushSubscriptionsCollection().deleteOne({ _id: sub._id });
      }
    }
  }
}

export const pushService = new PushService();
