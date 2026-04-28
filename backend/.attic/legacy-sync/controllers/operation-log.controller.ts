import { FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import { operationLogsCollection } from "../models/index.js";
import type { OperationLog } from "../models/operation-log.model.js";

export const operationLogController = {
  async pushOperationLogs(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    let accepted = 0;
    const serverIds: Record<string, string> = {};

    const body = req.body as {
      logs: Array<{
        clientId: string;
        _serverId?: string;
        category: string;
        action: string;
        result: "success" | "failure";
        target?: string;
        targetId?: string;
        details?: Record<string, unknown>;
        errorMessage?: string;
        timestamp: string;
        _rev: number;
      }>;
    };

    for (const incoming of body.logs) {
      if (incoming._serverId) {
        let oid: ObjectId;
        try {
          oid = new ObjectId(incoming._serverId);
        } catch {
          continue;
        }

        const existing = await operationLogsCollection().findOne({
          _id: oid,
          userId,
        });
        if (!existing) continue;

        if (incoming._rev >= existing._rev) {
          await operationLogsCollection().updateOne(
            { _id: oid },
            {
              $set: {
                category: incoming.category,
                action: incoming.action,
                result: incoming.result,
                target: incoming.target,
                targetId: incoming.targetId,
                details: incoming.details,
                errorMessage: incoming.errorMessage,
                timestamp: incoming.timestamp,
                updatedAt: now,
              },
              $inc: { _rev: 1 },
            },
          );
        }
        serverIds[incoming.clientId] = incoming._serverId;
        accepted++;
      } else {
        // Check for duplicate by clientId
        const existing = await operationLogsCollection().findOne({
          clientId: incoming.clientId,
          userId,
        });

        if (existing) {
          serverIds[incoming.clientId] = existing._id.toString();
          accepted++;
          continue;
        }

        const doc: Omit<OperationLog, "_id"> = {
          clientId: incoming.clientId,
          userId,
          category: incoming.category,
          action: incoming.action,
          result: incoming.result,
          target: incoming.target,
          targetId: incoming.targetId,
          details: incoming.details,
          errorMessage: incoming.errorMessage,
          timestamp: incoming.timestamp,
          _rev: 1,
          createdAt: now,
          updatedAt: now,
        };
        const result = await operationLogsCollection().insertOne(doc as OperationLog);
        serverIds[incoming.clientId] = result.insertedId.toString();
        accepted++;
      }
    }

    reply.send({ accepted, serverIds });
  },

  async pullOperationLogs(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { lastPulledAt?: string };
    const since = body.lastPulledAt
      ? new Date(body.lastPulledAt)
      : new Date(0);

    const logs = await operationLogsCollection()
      .find({ userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({ logs, serverTime: new Date().toISOString() });
  },

  async clearOperationLogs(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const result = await operationLogsCollection().deleteMany({ userId });
    reply.send({ deleted: result.deletedCount });
  },
};
