import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/require-auth.js";
import {
  timerService,
  toPublicEntry,
  toPublicSession,
  toUtcDateKey,
} from "../services/timer.service.js";

// ─── Response shapes ──────────────────────────────────────────────────────────

const entryShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    ticketId: { type: "string" },
    date: { type: "string" },
    note: { type: "string", nullable: true },
    sortOrder: { type: "number", nullable: true },
    createdAt: { type: "string" },
    updatedAt: { type: "string", nullable: true },
  },
};

const sessionShape = {
  type: "object",
  properties: {
    id: { type: "string" },
    timeEntryId: { type: "string" },
    userId: { type: "string" },
    teamId: { type: "string" },
    ticketId: { type: "string" },
    date: { type: "string" },
    clockEventId: { type: "string", nullable: true },
    startTime: { type: "number" },
    endTime: { type: "number", nullable: true },
    durationSeconds: { type: "number", nullable: true },
    createdAt: { type: "string" },
  },
};

const dayEntryShape = {
  type: "object",
  properties: {
    entry: entryShape,
    sessions: { type: "array", items: sessionShape },
  },
};

const err = (description: string) => ({
  type: "object",
  properties: { error: { type: "string", example: description } },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function timerRoutes(app: FastifyInstance) {
  // GET /v1/timers/day?date=YYYY-MM-DD&tz=America/New_York
  app.get(
    "/timers/day",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "List TimeEntries with sessions for a local calendar day",
        querystring: {
          type: "object",
          required: ["date"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            tz: { type: "string", default: "UTC" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { entries: { type: "array", items: dayEntryShape } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { date, tz = "UTC" } = req.query as { date: string; tz?: string };
      const entries = await timerService.getDayEntries(userId, date, tz);
      return reply.send({
        entries: entries.map(({ entry, sessions }) => ({
          entry: toPublicEntry(entry),
          sessions: sessions.map(toPublicSession),
        })),
      });
    }
  );

  // GET /v1/timers/week?date=YYYY-MM-DD&tz=America/New_York
  // date = Monday of the week in local time
  app.get(
    "/timers/week",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get per-day totals for a 7-day week (Mon–Sun)",
        querystring: {
          type: "object",
          required: ["date"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            tz: { type: "string", default: "UTC" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              days: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string" },
                    totalSeconds: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { date, tz = "UTC" } = req.query as { date: string; tz?: string };
      const days = await timerService.getWeekTotals(userId, date, tz);
      return reply.send({ days });
    }
  );

  // POST /v1/timers/entries — create a TimeEntry (and optionally start a session)
  app.post(
    "/timers/entries",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Create a TimeEntry for a ticket on a given date",
        body: {
          type: "object",
          required: ["ticketId", "date"],
          additionalProperties: false,
          properties: {
            ticketId: { type: "string" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            note: { type: "string" },
            startNow: { type: "boolean", default: false },
            clockEventId: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              entry: entryShape,
              session: { ...sessionShape, nullable: true },
            },
          },
          403: err("Forbidden"),
          404: err("Ticket not found"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { ticketId, date, note, startNow, clockEventId } = req.body as {
        ticketId: string;
        date: string;
        note?: string;
        startNow?: boolean;
        clockEventId?: string;
      };

      const entryResult = await timerService.getOrCreateEntry(userId, ticketId, date);
      if (entryResult === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (entryResult === "forbidden") return reply.status(403).send({ error: "Forbidden" });

      if (note) {
        // Patch note onto entry (best-effort, non-critical)
        const { timeEntriesCollection } = await import("../models/index.js");
        const { ObjectId } = await import("mongodb");
        await timeEntriesCollection().updateOne(
          { _id: new ObjectId(entryResult._id) },
          { $set: { note, updatedAt: new Date() } }
        );
        entryResult.note = note;
      }

      let session = null;
      if (startNow) {
        const startResult = await timerService.startTimer(
          userId,
          ticketId,
          Date.now(),
          clockEventId
        );
        if (
          startResult !== "not-found" &&
          startResult !== "forbidden" &&
          startResult !== "already-running"
        ) {
          session = toPublicSession(startResult.session);
        }
      }

      return reply.status(201).send({ entry: toPublicEntry(entryResult), session });
    }
  );

  // POST /v1/timers/entries/:id/start — start a timer session for a TimeEntry
  app.post(
    "/timers/entries/:id/start",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Start a timer session for a TimeEntry",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            now: { type: "number" },
            clockEventId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              session: sessionShape,
              closedSessionId: { type: "string", nullable: true },
            },
          },
          404: err("TimeEntry not found"),
          403: err("Forbidden"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: entryId } = req.params as { id: string };
      const { now = Date.now(), clockEventId } = req.body as {
        now?: number;
        clockEventId?: string;
      };

      // Look up the TimeEntry to get ticketId
      const { timeEntriesCollection } = await import("../models/index.js");
      const { ObjectId } = await import("mongodb");
      if (!/^[0-9a-f]{24}$/i.test(entryId))
        return reply.status(404).send({ error: "TimeEntry not found" });
      const entry = await timeEntriesCollection().findOne({ _id: new ObjectId(entryId) });
      if (!entry) return reply.status(404).send({ error: "TimeEntry not found" });
      if (entry.userId !== userId) return reply.status(403).send({ error: "Forbidden" });

      const result = await timerService.startTimer(userId, entry.ticketId, now, clockEventId);
      if (result === "not-found") return reply.status(404).send({ error: "Ticket not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "already-running")
        return reply.status(409).send({ error: "Timer already running" });

      return reply.send({
        session: toPublicSession(result.session),
        closedSessionId: result.closedSessionId,
      });
    }
  );

  // POST /v1/timers/sessions/:id/stop — stop a running timer session
  app.post(
    "/timers/sessions/:id/stop",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Stop a running timer session",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { now: { type: "number" } },
        },
        response: {
          200: { type: "object", properties: { session: sessionShape } },
          404: err("Session not found"),
          403: err("Forbidden"),
          409: err("Session already stopped"),
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { id: sessionId } = req.params as { id: string };
      const { now = Date.now() } = req.body as { now?: number };

      const result = await timerService.stopTimer(userId, sessionId, now);
      if (result === "not-found") return reply.status(404).send({ error: "Session not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "already-stopped")
        return reply.status(409).send({ error: "Session already stopped" });

      return reply.send({ session: toPublicSession(result) });
    }
  );

  // POST /v1/timers/copy-previous — copy entries from most recent previous day
  app.post(
    "/timers/copy-previous",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Copy TimeEntry rows from the most recent previous day to today",
        body: {
          type: "object",
          required: ["toDate"],
          additionalProperties: false,
          properties: {
            toDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
        response: {
          200: { type: "object", properties: { created: { type: "number" } } },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { toDate } = req.body as { toDate: string };
      const created = await timerService.copyFromPrevious(userId, toDate);
      return reply.send({ created });
    }
  );

  // GET /v1/timers/tickets/:ticketId/total — total seconds for a ticket
  app.get(
    "/timers/tickets/:ticketId/total",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get total accumulated seconds for a ticket across all closed sessions",
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { totalSeconds: { type: "number" } } },
        },
      },
    },
    async (req, reply) => {
      const { ticketId } = req.params as { ticketId: string };
      const totalSeconds = await timerService.getTicketTotal(ticketId);
      return reply.send({ totalSeconds });
    }
  );

  // GET /v1/timers/running — get the current user's running session (if any)
  app.get(
    "/timers/running",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "Get the current user's running timer session, or null",
        response: {
          200: {
            type: "object",
            properties: { session: { ...sessionShape, nullable: true } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { timerSessionsCollection } = await import("../models/index.js");
      const session = await timerSessionsCollection().findOne({ userId, endTime: null });
      return reply.send({ session: session ? toPublicSession(session) : null });
    }
  );

  // GET /v1/timers/today?tz= — shorthand for today's day view
  app.get(
    "/timers/today",
    {
      preHandler: [requireAuth],
      schema: {
        tags: ["Timers"],
        summary: "List TimeEntries for today (local time)",
        querystring: {
          type: "object",
          properties: { tz: { type: "string", default: "UTC" } },
        },
      },
    },
    async (req, reply) => {
      const { id: userId } = (req as any).user;
      const { tz = "UTC" } = req.query as { tz?: string };
      const today = toUtcDateKey(Date.now());
      const entries = await timerService.getDayEntries(userId, today, tz);
      return reply.send({
        entries: entries.map(({ entry, sessions }) => ({
          entry: toPublicEntry(entry),
          sessions: sessions.map(toPublicSession),
        })),
      });
    }
  );
}
