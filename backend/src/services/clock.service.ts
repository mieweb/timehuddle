import { ObjectId } from "mongodb";
import {
  clockEventsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
} from "../models/index.js";
import type { ClockEvent, ClockEventTicket } from "../models/clock.model.js";
import { notificationService } from "./notification.service.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────

type SseListener = (teamId: string, event: PublicClockEvent | null) => void;
const sseListeners = new Set<SseListener>();

export function subscribeSse(fn: SseListener): () => void {
  sseListeners.add(fn);
  return () => sseListeners.delete(fn);
}

function broadcast(teamId: string, event: PublicClockEvent | null) {
  for (const fn of sseListeners) fn(teamId, event);
}

// ─── Public shape ─────────────────────────────────────────────────────────────

export function toPublicClockEvent(e: ClockEvent) {
  return {
    id: e._id.toHexString(),
    userId: e.userId,
    teamId: e.teamId,
    startTimestamp: e.startTimestamp,
    accumulatedTime: e.accumulatedTime,
    tickets: (e.tickets ?? []).map((t) => ({
      ticketId: t.ticketId,
      startTimestamp: t.startTimestamp ?? null,
      accumulatedTime: t.accumulatedTime,
      sessions: (t.sessions ?? []).map((s) => ({
        startTimestamp: s.startTimestamp,
        endTimestamp: s.endTimestamp,
      })),
    })),
    endTime: e.endTime ? e.endTime.toISOString() : null,
    youtubeShortLink: e.youtubeShortLink ?? null,
  };
}

export type PublicClockEvent = ReturnType<typeof toPublicClockEvent>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function stopTicketInEvent(
  clockEventId: ObjectId,
  ticketId: string,
  now: number
): Promise<void> {
  const coll = clockEventsCollection();
  const event = await coll.findOne({ _id: clockEventId });
  if (!event) return;
  const entry = event.tickets?.find((t) => t.ticketId === ticketId);
  if (!entry?.startTimestamp) return;

  const elapsed = Math.floor((now - entry.startTimestamp) / 1000);
  const prev = entry.accumulatedTime ?? 0;
  const updatedSessions = (entry.sessions ?? []).map((s) =>
    s.endTimestamp === null ? { ...s, endTimestamp: now } : s
  );

  await coll.updateOne(
    { _id: clockEventId, "tickets.ticketId": ticketId },
    {
      $set: {
        "tickets.$.accumulatedTime": prev + elapsed,
        "tickets.$.sessions": updatedSessions,
      },
      $unset: { "tickets.$.startTimestamp": "" },
    }
  );
}

// ─── ClockService ─────────────────────────────────────────────────────────────

export class ClockService {
  /** Return the active (open) clock event for a user in a team, or null. */
  async getActive(userId: string, teamId: string): Promise<ClockEvent | null> {
    return clockEventsCollection().findOne({ userId, teamId, endTime: null });
  }

  /** Return the active clock event across any team for the user. */
  async getActiveForUser(userId: string): Promise<ClockEvent | null> {
    return clockEventsCollection().findOne({ userId, endTime: null });
  }

  /** All clock events for a user (for their own timesheet & history). */
  async getForUser(userId: string): Promise<ClockEvent[]> {
    return clockEventsCollection().find({ userId }).sort({ startTimestamp: -1 }).toArray();
  }

  /** Live clock events for a set of teams (used by SSE + dashboard). */
  async getLiveForTeams(teamIds: string[]): Promise<ClockEvent[]> {
    if (!teamIds.length) return [];
    return clockEventsCollection()
      .find({ teamId: { $in: teamIds }, endTime: null })
      .toArray();
  }

  async start(userId: string, teamId: string): Promise<PublicClockEvent | "forbidden"> {
    if (!isValidId(teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";

    const coll = clockEventsCollection();

    // Close any open events for this user+team
    await coll.updateMany({ userId, teamId, endTime: null }, { $set: { endTime: new Date() } });

    const now = Date.now();
    const result = await coll.insertOne({
      _id: new ObjectId(),
      userId,
      teamId,
      startTimestamp: now,
      accumulatedTime: 0,
      tickets: [],
      endTime: null,
    });

    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return "forbidden";
    const pub = toPublicClockEvent(created);
    broadcast(teamId, pub);

    // Notify team admins
    const user = await usersCollection().findOne({ _id: userId });
    const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
    const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
    await Promise.all(
      notifyAdmins.map((adminId) =>
        notificationService
          .create({
            userId: adminId,
            title: "TiméHuddle",
            body: `${userName} clocked in to ${team.name}`,
            notificationData: {
              type: "clock-in",
              userId,
              userName,
              teamName: team.name,
              teamId,
              url: `/member/${teamId}/${userId}`,
            },
          })
          .catch(() => {})
      )
    );

    return pub;
  }

  async stop(
    userId: string,
    teamId: string,
    youtubeShortLink?: string
  ): Promise<PublicClockEvent | "not-found"> {
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";

    const now = Date.now();

    // Accumulate time
    const elapsed = Math.floor((now - event.startTimestamp) / 1000);
    const prev = event.accumulatedTime ?? 0;

    // Stop all running ticket timers inside the event
    for (const t of (event.tickets ?? []).filter((t) => t.startTimestamp)) {
      await stopTicketInEvent(event._id, t.ticketId, now);
    }

    // Also stop any free-running ticket timers in the tickets collection
    const tColl = ticketsCollection();
    const running = await tColl
      .find({ teamId, createdBy: userId, startTimestamp: { $exists: true } })
      .toArray();
    for (const ticket of running) {
      const telapsed = Math.floor((now - (ticket.startTimestamp ?? 0)) / 1000);
      const tprev = ticket.accumulatedTime ?? 0;
      await tColl.updateOne(
        { _id: ticket._id },
        { $set: { accumulatedTime: tprev + telapsed }, $unset: { startTimestamp: "" } }
      );
    }

    const $set: Record<string, unknown> = {
      endTime: new Date(),
      accumulatedTime: prev + elapsed,
    };
    if (youtubeShortLink?.trim()) $set.youtubeShortLink = youtubeShortLink.trim();

    await coll.updateOne({ _id: event._id }, { $set });

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(teamId, null); // null = user is no longer clocked in

    // Notify team admins
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (team) {
      const user = await usersCollection().findOne({ _id: userId });
      const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
      const totalSecs = pub.accumulatedTime ?? 0;
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
      await Promise.all(
        notifyAdmins.map((adminId) =>
          notificationService
            .create({
              userId: adminId,
              title: "TiméHuddle",
              body: `${userName} clocked out of ${team.name} (${durationText})`,
              notificationData: {
                type: "clock-out",
                userId,
                userName,
                teamName: team.name,
                teamId,
                duration: durationText,
                url: `/member/${teamId}/${userId}`,
              },
            })
            .catch(() => {})
        )
      );
    }

    return pub;
  }

  async addTicket(
    userId: string,
    clockEventId: string,
    ticketId: string,
    now: number
  ): Promise<PublicClockEvent | "not-found" | "forbidden"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({
      _id: new ObjectId(clockEventId),
      userId,
      endTime: null,
    });
    if (!event) return "not-found";

    const existing = event.tickets?.find((t) => t.ticketId === ticketId);
    if (existing) {
      await coll.updateOne(
        { _id: event._id, "tickets.ticketId": ticketId },
        {
          $set: { "tickets.$.startTimestamp": now },
          $push: { "tickets.$.sessions": { startTimestamp: now, endTimestamp: null } } as any,
        }
      );
    } else {
      // Grab accumulated time from the tickets collection
      const ticket = isValidId(ticketId)
        ? await ticketsCollection().findOne({ _id: new ObjectId(ticketId) })
        : null;
      const initialTime = ticket?.accumulatedTime ?? 0;
      const entry: ClockEventTicket = {
        ticketId,
        startTimestamp: now,
        accumulatedTime: initialTime,
        sessions: [{ startTimestamp: now, endTimestamp: null }],
      };
      await coll.updateOne({ _id: event._id }, { $push: { tickets: entry } } as any);
    }

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(event.teamId, pub);
    return pub;
  }

  async stopTicket(
    userId: string,
    clockEventId: string,
    ticketId: string,
    now: number
  ): Promise<PublicClockEvent | "not-found"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({
      _id: new ObjectId(clockEventId),
      userId,
    });
    if (!event) return "not-found";

    await stopTicketInEvent(event._id, ticketId, now);

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(event.teamId, pub);
    return pub;
  }

  async updateYoutubeLink(
    userId: string,
    clockEventId: string,
    youtubeShortLink: string
  ): Promise<PublicClockEvent | "not-found"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({ _id: new ObjectId(clockEventId), userId });
    if (!event) return "not-found";
    const link = youtubeShortLink.trim();
    if (link) await coll.updateOne({ _id: event._id }, { $set: { youtubeShortLink: link } });
    const updated = await coll.findOne({ _id: event._id });
    return updated ? toPublicClockEvent(updated) : "not-found";
  }

  async updateTimes(
    requesterId: string,
    clockEventId: string,
    data: { startTimestamp?: number; endTimestamp?: number | null }
  ): Promise<PublicClockEvent | "not-found" | "forbidden" | "invalid-range"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({ _id: new ObjectId(clockEventId) });
    if (!event) return "not-found";

    // Must be a team admin
    const team = await teamsCollection().findOne({
      _id: new ObjectId(event.teamId),
      admins: requesterId,
    });
    if (!team) return "forbidden";

    if (
      typeof data.startTimestamp === "number" &&
      typeof data.endTimestamp === "number" &&
      data.endTimestamp < data.startTimestamp
    ) {
      return "invalid-range";
    }

    const $set: Record<string, unknown> = {};
    if (typeof data.startTimestamp === "number") $set.startTimestamp = data.startTimestamp;
    if (data.endTimestamp === null) $set.endTime = null;
    else if (typeof data.endTimestamp === "number") $set.endTime = new Date(data.endTimestamp);

    if (Object.keys($set).length > 0) await coll.updateOne({ _id: event._id }, { $set });

    const updated = await coll.findOne({ _id: event._id });
    return updated ? toPublicClockEvent(updated) : "not-found";
  }

  async getTimesheet(
    requesterId: string,
    targetUserId: string,
    startDate: string,
    endDate: string
  ): Promise<
    | {
        sessions: ReturnType<typeof toPublicClockEvent>[];
        summary: {
          totalSeconds: number;
          totalSessions: number;
          completedSessions: number;
          averageSessionSeconds: number;
          workingDays: number;
        };
      }
    | "forbidden"
  > {
    // Verify shared team membership
    const myTeams = await teamsCollection().find({ members: requesterId }).toArray();
    const sharedTeam = myTeams.some(
      (t) => t.members.includes(targetUserId) || t.admins.includes(targetUserId)
    );
    if (!sharedTeam && requesterId !== targetUserId) return "forbidden";

    const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${endDate}T23:59:59.999Z`).getTime();

    const events = await clockEventsCollection()
      .find({ userId: targetUserId, startTimestamp: { $gte: start, $lte: end } })
      .sort({ startTimestamp: -1 })
      .toArray();

    const sessions = events.map(toPublicClockEvent);
    const completed = sessions.filter((s) => s.endTime !== null);
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) return sum + s.accumulatedTime;
      return sum + Math.floor((new Date(s.endTime).getTime() - s.startTimestamp) / 1000);
    }, 0);
    const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
    const uniqueDates = new Set(
      sessions.map((s) => new Date(s.startTimestamp).toISOString().split("T")[0])
    );

    return {
      sessions,
      summary: {
        totalSeconds,
        totalSessions: sessions.length,
        completedSessions: completed.length,
        averageSessionSeconds: avgSeconds,
        workingDays: uniqueDates.size,
      },
    };
  }
}

export const clockService = new ClockService();
