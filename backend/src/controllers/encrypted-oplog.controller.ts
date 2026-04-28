import { FastifyRequest, FastifyReply } from "fastify";
import { encryptedOpLogsCollection, recoveryKeyStatusCollection } from "../models/index.js";
import type { EncryptedOpLogBatch } from "../models/encrypted-oplog.model.js";

/**
 * Encrypted op-log relay controller.
 *
 * The server is a dumb relay — it stores encrypted blobs and forwards
 * them to the user's other devices.  It never decrypts anything.
 */

export const encryptedOpLogController = {
  // ── Push: client sends encrypted batch ────────────────────

  async pushOpLog(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as {
      deviceId: string;
      lastHLC: string;
      count: number;
      payload: { iv: string; ciphertext: string };
    };

    const now = new Date();
    const doc: Omit<EncryptedOpLogBatch, "_id"> = {
      userId,
      deviceId: body.deviceId,
      hlc: body.lastHLC,
      count: body.count,
      encryptedPayload: body.payload,
      createdAt: now,
    };

    await encryptedOpLogsCollection().insertOne(doc as EncryptedOpLogBatch);

    reply.send({ accepted: body.count });
  },

  // ── Pull: client fetches batches from other devices ───────

  async pullOpLog(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const query = req.query as { deviceId?: string; since?: string };

    const filter: Record<string, unknown> = {
      userId,
    };

    // Exclude the requesting device's own batches
    if (query.deviceId) {
      filter.deviceId = { $ne: query.deviceId };
    }

    // Only return batches newer than the cursor
    if (query.since) {
      filter.hlc = { $gt: query.since };
    }

    const batches = await encryptedOpLogsCollection()
      .find(filter)
      .sort({ hlc: 1 })
      .limit(100) // cap per request
      .toArray();

    // Project to the shape the client expects (strip Mongo internals)
    const result = batches.map((b) => ({
      deviceId: b.deviceId,
      lastHLC: b.hlc,
      count: b.count,
      payload: b.encryptedPayload,
    }));

    reply.send({ batches: result, serverTime: new Date().toISOString() });
  },

  // ── Status: check whether user has any encrypted data ──────

  async hasData(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const count = await encryptedOpLogsCollection().countDocuments({ userId }, { limit: 1 });
    reply.send({ hasData: count > 0 });
  },

  // ── Compact: remove old batches all devices have consumed ─

  async compactOpLog(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { deviceId: string; beforeHLC: string };

    const result = await encryptedOpLogsCollection().deleteMany({
      userId,
      hlc: { $lte: body.beforeHLC },
    });

    reply.send({ deleted: result.deletedCount });
  },

  // ── Purge: delete ALL encrypted batches for this user ─────

  async purgeAll(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = (req.body as { legacyUserId?: string } | undefined) ?? {};

    // Delete data under the current userId (identity UUID)
    // AND any data under the old auth userId if provided
    const userIds = [userId];
    if (body.legacyUserId && body.legacyUserId !== userId) {
      userIds.push(body.legacyUserId);
    }

    const result = await encryptedOpLogsCollection().deleteMany({
      userId: { $in: userIds },
    });

    reply.send({ deleted: result.deletedCount });
  },

  // ── Recovery key status ───────────────────────────────────

  async markRecoveryKeySaved(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;

    await recoveryKeyStatusCollection().updateOne(
      { userId },
      { $set: { saved: true, savedAt: new Date() } },
      { upsert: true }
    );

    reply.send({ ok: true });
  },

  async getRecoveryKeyStatus(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;

    const doc = await recoveryKeyStatusCollection().findOne({ userId });
    reply.send({ saved: doc?.saved ?? false });
  },

  async resetRecoveryKeySaved(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;

    await recoveryKeyStatusCollection().deleteOne({ userId });
    reply.send({ ok: true });
  },
};
