import { FastifyRequest, FastifyReply } from "fastify";
import {
  workSessionsCollection,
  userDailyStatsCollection,
} from "../models/index.js";
import {
  computeSession,
  computeDay,
  type RawSession,
} from "@timeharbor/time-engine";
import type { WorkSession } from "../models/work-session.model.js";

function toRaw(s: WorkSession): RawSession {
  return {
    clockIn: s.clockIn,
    clockOut: s.clockOut,
    ticketSegments: s.ticketSegments,
    breaks: s.breaks,
  };
}

async function recomputeDailyStats(userId: string, date: string) {
  const sessions = await workSessionsCollection()
    .find({ userId, date })
    .toArray();

  const raw = sessions.map(toRaw);
  const now = Date.now();
  const stats = computeDay(raw, date, now);

  await userDailyStatsCollection().updateOne(
    { userId, date },
    {
      $set: {
        totalSessionMs: stats.totalSessionMs,
        totalBreakMs: stats.totalBreakMs,
        netWorkMs: stats.netWorkMs,
        ticketBreakdown: stats.ticketBreakdown,
        sessionCount: stats.sessionCount,
      },
    },
    { upsert: true }
  );
}

export const timeController = {
  async syncSessions(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const now = Date.now();
    let accepted = 0;
    const affectedDates = new Set<string>();
    const body = req.body as {
      sessions: Array<{
        clientSessionId: string;
        date: string;
        clockIn: number;
        clockOut: number | null;
        ticketSegments: WorkSession["ticketSegments"];
        breaks: WorkSession["breaks"];
        totalSessionMs: number;
        totalBreakMs: number;
        netWorkMs: number;
        ticketBreakdown: WorkSession["ticketBreakdown"];
        comment?: string;
        links?: string[];
        attachments?: Array<{ name: string; type: string; dataUrl: string }>;
        sourceApp?: string;
        _rev: number;
      }>;
    };

    for (const incoming of body.sessions) {
      const existing = await workSessionsCollection().findOne({
        clientSessionId: incoming.clientSessionId,
      });

      // Re-verify totals from raw data
      const raw: RawSession = {
        clockIn: incoming.clockIn,
        clockOut: incoming.clockOut,
        ticketSegments: incoming.ticketSegments,
        breaks: incoming.breaks,
      };
      const refTime = incoming.clockOut ?? now;
      const verified = computeSession(raw, refTime);

      const doc: Omit<WorkSession, "_id"> = {
        clientSessionId: incoming.clientSessionId,
        userId,
        date: incoming.date,
        clockIn: incoming.clockIn,
        clockOut: incoming.clockOut,
        ticketSegments: incoming.ticketSegments,
        breaks: incoming.breaks,
        totalSessionMs: verified.totalSessionMs,
        totalBreakMs: verified.totalBreakMs,
        netWorkMs: verified.netWorkMs,
        ticketBreakdown: verified.ticketBreakdown,
        comment: incoming.comment,
        links: incoming.links,
        attachments: incoming.attachments,
        sourceApp: "timeharbor",
        _rev: incoming._rev,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      if (!existing) {
        await workSessionsCollection().insertOne(doc as WorkSession);
        accepted++;
      } else if (incoming._rev > existing._rev) {
        await workSessionsCollection().updateOne(
          { clientSessionId: incoming.clientSessionId },
          { $set: { ...doc, createdAt: existing.createdAt } }
        );
        accepted++;
      }

      affectedDates.add(incoming.date);
    }

    // Recompute daily stats for all affected dates
    for (const date of affectedDates) {
      await recomputeDailyStats(userId, date);
    }

    reply.send({
      accepted,
      affectedDates: Array.from(affectedDates),
    });
  },

  async pullSessions(req: FastifyRequest, reply: FastifyReply) {
    const userId = req.user!.id;
    const query = req.query as { since?: string };
    const since = query.since ? new Date(query.since).getTime() : 0;

    const sessions = await workSessionsCollection()
      .find({ userId, updatedAt: { $gt: since } })
      .sort({ updatedAt: 1 })
      .toArray();

    reply.send({
      sessions,
      serverTime: new Date().toISOString(),
    });
  },
};

export { recomputeDailyStats };
