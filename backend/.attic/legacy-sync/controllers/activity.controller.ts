import { FastifyRequest, FastifyReply } from "fastify";
import { getDB } from "../lib/db.js";

interface ActivityLog {
  clientId: string;
  userId: string;
  teamId?: string;
  type: string;
  title: string;
  subtitle?: string;
  description?: string;
  link?: string;
  startTime: string;
  endTime?: string;
  status?: string;
  duration?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  _rev: number;
  _deleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function activitiesCollection() {
  return getDB().collection<ActivityLog>("activityLogs");
}

export const activityController = {
  async pushActivities(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = new Date();
    let accepted = 0;

    const body = req.body as {
      activities: Array<{
        clientId: string;
        teamId?: string;
        type: string;
        title: string;
        subtitle?: string;
        description?: string;
        link?: string;
        startTime: string;
        endTime?: string;
        status?: string;
        duration?: string;
        durationMs?: number;
        metadata?: Record<string, unknown>;
        _rev: number;
        _deleted: boolean;
      }>;
    };

    for (const incoming of body.activities) {
      const existing = await activitiesCollection().findOne({
        clientId: incoming.clientId,
        userId,
      });

      if (existing) {
        if (incoming._rev >= existing._rev) {
          await activitiesCollection().updateOne(
            { clientId: incoming.clientId, userId },
            {
              $set: {
                teamId: incoming.teamId,
                type: incoming.type,
                title: incoming.title,
                subtitle: incoming.subtitle,
                description: incoming.description,
                link: incoming.link,
                startTime: incoming.startTime,
                endTime: incoming.endTime,
                status: incoming.status,
                duration: incoming.duration,
                durationMs: incoming.durationMs,
                metadata: incoming.metadata,
                updatedAt: now,
              },
              $inc: { _rev: 1 },
            },
          );
        }
      } else {
        await activitiesCollection().insertOne({
          clientId: incoming.clientId,
          userId,
          teamId: incoming.teamId,
          type: incoming.type,
          title: incoming.title,
          subtitle: incoming.subtitle,
          description: incoming.description,
          link: incoming.link,
          startTime: incoming.startTime,
          endTime: incoming.endTime,
          status: incoming.status,
          duration: incoming.duration,
          durationMs: incoming.durationMs,
          metadata: incoming.metadata,
          _rev: incoming._rev ?? 1,
          _deleted: incoming._deleted ?? false,
          createdAt: now,
          updatedAt: now,
        });
      }
      accepted++;
    }

    reply.send({ accepted });
  },

  async pullActivities(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const body = req.body as { lastPulledAt?: string };
    const since = body.lastPulledAt
      ? new Date(body.lastPulledAt)
      : new Date(0);

    const activities = await activitiesCollection()
      .find({ userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({ activities, serverTime: new Date().toISOString() });
  },
};
