import { ObjectId } from "mongodb";
import { clockEventsCollection, teamsCollection, usersCollection } from "../models/index.js";
import type { ClockEvent } from "../models/clock.model.js";
import { timerService } from "./timer.service.js";
import { notificationService } from "./notification.service.js";
import { pushService } from "./push.service.js";

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
  // Backwards-compat: documents created before the startTimestamp→startTime
  // rename (commit 31ce962) still have the old field name in MongoDB.
  const raw = e as unknown as Record<string, unknown>;
  const startTime =
    typeof e.startTime === "number"
      ? e.startTime
      : typeof raw["startTimestamp"] === "number"
        ? (raw["startTimestamp"] as number)
        : 0;

  // endTime was previously stored as a Date; coerce to epoch ms if needed.
  const rawEndTime = raw["endTime"];
  const endTime =
    rawEndTime instanceof Date
      ? rawEndTime.getTime()
      : typeof rawEndTime === "number"
        ? rawEndTime
        : null;

  return {
    id: e._id.toHexString(),
    userId: e.userId,
    teamId: e.teamId,
    startTime,
    accumulatedTime: e.accumulatedTime,
    endTime,
  };
}

export type PublicClockEvent = ReturnType<typeof toPublicClockEvent>;

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
    return clockEventsCollection().find({ userId }).sort({ startTime: -1 }).toArray();
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
    const now = Date.now();
    await coll.updateMany({ userId, teamId, endTime: null }, { $set: { endTime: now } });

    const result = await coll.insertOne({
      _id: new ObjectId(),
      userId,
      teamId,
      startTime: now,
      accumulatedTime: 0,
      tickets: [],
      endTime: null,
    });

    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return "forbidden";
    const pub = toPublicClockEvent(created);
    broadcast(teamId, pub);

    // Notify team admins
    const user = isValidId(userId)
      ? await usersCollection().findOne({ _id: new ObjectId(userId) })
      : null;
    const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
    const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
    await Promise.all(
      notifyAdmins.map((adminId) =>
        Promise.all([
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
                url: `/app/clock`,
              },
            })
            .catch(() => {}),
          pushService
            .sendPush(adminId, {
              title: `${userName} clocked in`,
              body: `${userName} clocked in to ${team.name}`,
              tag: `clock-in-${teamId}-${userId}`,
              data: {
                type: "clock-in",
                userId,
                userName,
                teamName: team.name,
                teamId,
                url: `/app/clock`,
              },
            })
            .catch(() => {}),
        ])
      )
    );

    return pub;
  }

  async stop(userId: string, teamId: string): Promise<PublicClockEvent | "not-found"> {
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";

    const now = Date.now();

    // Accumulate time
    const elapsed = Math.floor((now - event.startTime) / 1000);
    const prev = event.accumulatedTime ?? 0;

    // Close all open timer sessions for this user in a single updateMany
    await timerService.closeAllForUser(userId, now);

    const $set: Record<string, unknown> = {
      endTime: now,
      accumulatedTime: prev + elapsed,
    };

    await coll.updateOne({ _id: event._id }, { $set });

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(teamId, null); // null = user is no longer clocked in

    // Notify team admins
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (team) {
      const user = isValidId(userId)
        ? await usersCollection().findOne({ _id: new ObjectId(userId) })
        : null;
      const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
      const totalSecs = pub.accumulatedTime ?? 0;
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
      await Promise.all(
        notifyAdmins.map((adminId) =>
          Promise.all([
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
                  url: `/app/clock`,
                },
              })
              .catch(() => {}),
            pushService
              .sendPush(adminId, {
                title: `${userName} clocked out`,
                body: `${userName} clocked out of ${team.name} (${durationText})`,
                tag: `clock-out-${teamId}-${userId}`,
                data: {
                  type: "clock-out",
                  userId,
                  userName,
                  teamName: team.name,
                  teamId,
                  duration: durationText,
                  url: `/app/clock`,
                },
              })
              .catch(() => {}),
          ])
        )
      );
    }

    return pub;
  }

  async updateTimes(
    requesterId: string,
    clockEventId: string,
    data: { startTime?: number; endTime?: number | null }
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

    // Resolve the effective start/end after the partial update to validate the range.
    const effectiveStart = typeof data.startTime === "number" ? data.startTime : event.startTime;
    const effectiveEnd =
      data.endTime === null
        ? null
        : typeof data.endTime === "number"
          ? data.endTime
          : event.endTime;
    if (effectiveEnd !== null && effectiveEnd < effectiveStart) {
      return "invalid-range";
    }

    const $set: Record<string, unknown> = {};
    if (typeof data.startTime === "number") $set.startTime = data.startTime;
    if (data.endTime === null) $set.endTime = null;
    else if (typeof data.endTime === "number") $set.endTime = data.endTime;

    if (Object.keys($set).length > 0) await coll.updateOne({ _id: event._id }, { $set });

    const updated = await coll.findOne({ _id: event._id });
    return updated ? toPublicClockEvent(updated) : "not-found";
  }

  async getTimesheet(
    requesterId: string,
    targetUserId: string,
    startMs: number,
    endMs: number
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

    const events = await clockEventsCollection()
      .find({ userId: targetUserId, startTime: { $gte: startMs, $lte: endMs } })
      .sort({ startTime: -1 })
      .toArray();

    const sessions = events.map(toPublicClockEvent);
    const completed = sessions.filter((s) => s.endTime !== null);
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) return sum + s.accumulatedTime;
      return sum + Math.floor((s.endTime - s.startTime) / 1000);
    }, 0);
    const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
    const uniqueDates = new Set(
      sessions.map((s) => new Date(s.startTime).toISOString().split("T")[0])
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
