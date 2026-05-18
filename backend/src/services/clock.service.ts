import { ObjectId } from "mongodb";

import {
  attachmentsCollection,
  clockEventsCollection,
  teamsCollection,
  usersCollection,
} from "../models/index.js";
import type { ClockEvent } from "../models/clock.model.js";
import {
  findActiveClockEventByUser,
  findActiveClockEventByUserTeam,
  findClockEventsForUser,
  findLiveClockEventsForTeams,
} from "../models/clock.model.js";
import { timerService } from "./timer.service.js";
import { ActivityType } from "../models/activity.model.js";

import { notificationService } from "./notification.service.js";
import { emitActivity } from "./activity.service.js";

const MAX_WORK_SECONDS_PER_DAY = 8 * 60 * 60;

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

function getElapsedSeconds(fromEpochMs: number, nowEpochMs: number): number {
  return Math.max(0, Math.floor((nowEpochMs - fromEpochMs) / 1000));
}

function getActiveWorkSeconds(
  event: { accumulatedTime?: number; pausedAt?: number | null; startTime: number },
  now: number
): number {
  const base = event.accumulatedTime ?? 0;
  const isPaused = typeof event.pausedAt === "number";
  if (isPaused) return Math.min(MAX_WORK_SECONDS_PER_DAY, base);
  return Math.min(MAX_WORK_SECONDS_PER_DAY, base + getElapsedSeconds(event.startTime, now));
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────

type SseListener = (teamId: string, event: PublicClockEvent | null) => void;
const sseListeners = new Set<SseListener>();

export function subscribe(fn: SseListener): () => void {
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

  const rawPausedAt = raw["pausedAt"];
  const pausedAt =
    rawPausedAt instanceof Date
      ? rawPausedAt.getTime()
      : typeof rawPausedAt === "number"
        ? rawPausedAt
        : null;

  const totalPausedSeconds =
    typeof e.totalPausedSeconds === "number"
      ? e.totalPausedSeconds
      : typeof raw["totalPausedSeconds"] === "number"
        ? (raw["totalPausedSeconds"] as number)
        : 0;

  const breakSegments = Array.isArray(raw["breakSegments"])
    ? (raw["breakSegments"] as Array<Record<string, unknown>>)
        .map((segment) => {
          const rawPausedAt = segment["pausedAt"];
          const rawResumedAt = segment["resumedAt"];
          const pausedAt =
            rawPausedAt instanceof Date
              ? rawPausedAt.getTime()
              : typeof rawPausedAt === "number"
                ? rawPausedAt
                : null;
          const resumedAt =
            rawResumedAt instanceof Date
              ? rawResumedAt.getTime()
              : typeof rawResumedAt === "number"
                ? rawResumedAt
                : null;
          if (pausedAt === null) return null;
          return { pausedAt, resumedAt };
        })
        .filter((segment): segment is { pausedAt: number; resumedAt: number | null } =>
          segment !== null
        )
    : [];

  const now = Date.now();
  const workSeconds = getActiveWorkSeconds(e, now);

  return {
    id: e._id.toHexString(),
    userId: e.userId,
    teamId: e.teamId,
    startTime,
    accumulatedTime: e.accumulatedTime,
    workSeconds,
    isPaused: pausedAt !== null,
    pausedAt,
    totalPausedSeconds,
    breakSegments,
    endTime,
  };
}

export type PublicClockEvent = ReturnType<typeof toPublicClockEvent>;

// ─── ClockService ─────────────────────────────────────────────────────────────

export class ClockService {
  /** Return the active (open) clock event for a user in a team, or null. */
  async getActive(userId: string, teamId: string): Promise<ClockEvent | null> {
    return findActiveClockEventByUserTeam(userId, teamId);
  }

  /** Return the active clock event across any team for the user. */
  async getActiveForUser(userId: string): Promise<ClockEvent | null> {
    return findActiveClockEventByUser(userId);
  }

  /** All clock events for a user (for their own timesheet & history). */
  async getForUser(userId: string): Promise<ClockEvent[]> {
    return findClockEventsForUser(userId);
  }

  /** Live clock events for a set of teams (used by SSE + dashboard). */
  async getLiveForTeams(teamIds: string[]): Promise<ClockEvent[]> {
    return findLiveClockEventsForTeams(teamIds);
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
      breakSegments: [],
      pausedAt: null,
      totalPausedSeconds: 0,
      pauseStartedSessionId: null,
      notifiedAt3h: null,
      notifiedAt4h: null,
      autoClockedOutAt: null,
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
          .catch(() => {})
      )
    );

    void emitActivity({
      userId,
      teamId,
      type: ActivityType.ClockIn,
      actor: { id: userId, name: userName },
      payload: { teamId, teamName: team.name },
    });

    return pub;
  }

  async stop(userId: string, teamId: string): Promise<PublicClockEvent | "not-found"> {
    return this.stopWithReason(userId, teamId);
  }

  async stopWithReason(
    userId: string,
    teamId: string,
    reason?: "auto-8h"
  ): Promise<PublicClockEvent | "not-found"> {
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";

    const now = Date.now();

    const prev = event.accumulatedTime ?? 0;
    const elapsed =
      typeof event.pausedAt === "number" ? 0 : getElapsedSeconds(event.startTime, now);
    const finalSeconds = Math.min(MAX_WORK_SECONDS_PER_DAY, prev + elapsed);

    // Close all open timer sessions for this user in a single updateMany
    await timerService.closeAllForUser(userId, now);

    const $set: Record<string, unknown> = {
      endTime: now,
      accumulatedTime: finalSeconds,
      pausedAt: null,
      pauseStartedSessionId: null,
      ...(reason === "auto-8h" ? { autoClockedOutAt: now } : {}),
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
            .catch(() => {})
        )
      );

      if (reason === "auto-8h") {
        await notificationService.create({
          userId,
          title: "TiméHuddle",
          body: "Done for the day. Locked 8 hours and clocked you out.",
          notificationData: {
            type: "auto-clockout-8h",
            teamId,
            userId,
            url: "/app/clock",
          },
        });
      }

      void emitActivity({
        userId,
        teamId,
        type: ActivityType.ClockOut,
        actor: { id: userId, name: userName },
        payload: {
          teamId,
          teamName: team.name,
          durationSeconds: pub.accumulatedTime ?? undefined,
        },
      });
    }

    return pub;
  }

  async pause(
    userId: string,
    teamId: string
  ): Promise<PublicClockEvent | "not-found" | "already-paused"> {
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";
    if (typeof event.pausedAt === "number") return "already-paused";

    const now = Date.now();
    const elapsed = getElapsedSeconds(event.startTime, now);
    const nextAccumulated = Math.min(
      MAX_WORK_SECONDS_PER_DAY,
      (event.accumulatedTime ?? 0) + elapsed
    );
    const pausedSessionId = await timerService.closeRunningForUser(userId, now);
    const breakSegments = Array.isArray(event.breakSegments) ? event.breakSegments : [];

    await coll.updateOne(
      { _id: event._id, endTime: null },
      {
        $set: {
          accumulatedTime: nextAccumulated,
          pausedAt: now,
          startTime: now,
          pauseStartedSessionId: pausedSessionId,
          breakSegments: [...breakSegments, { pausedAt: now, resumedAt: null }],
        },
      }
    );

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(teamId, pub);
    return pub;
  }

  async resume(
    userId: string,
    teamId: string
  ): Promise<PublicClockEvent | "not-found" | "not-paused"> {
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";
    if (typeof event.pausedAt !== "number") return "not-paused";

    const now = Date.now();
    const pausedSeconds = getElapsedSeconds(event.pausedAt, now);
    const totalPausedSeconds = (event.totalPausedSeconds ?? 0) + pausedSeconds;
    const pausedSessionId = event.pauseStartedSessionId ?? null;
    const breakSegments = Array.isArray(event.breakSegments) ? [...event.breakSegments] : [];
    for (let i = breakSegments.length - 1; i >= 0; i -= 1) {
      if (breakSegments[i]?.resumedAt == null) {
        breakSegments[i] = { ...breakSegments[i], resumedAt: now };
        break;
      }
    }

    await coll.updateOne(
      { _id: event._id, endTime: null },
      {
        $set: {
          startTime: now,
          pausedAt: null,
          totalPausedSeconds,
          pauseStartedSessionId: null,
          breakSegments,
        },
      }
    );

    if (pausedSessionId && isValidId(pausedSessionId)) {
      const pausedSession = await timerService.getSessionById(pausedSessionId);
      if (pausedSession && pausedSession.userId === userId) {
        await timerService.startTimerForEntry(userId, pausedSession.workItemId, now);
      }
    }

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated);
    broadcast(teamId, pub);
    return pub;
  }

  async getStatus(
    userId: string,
    teamId: string
  ): Promise<
    | {
        event: PublicClockEvent;
        workSeconds: number;
        remainingSeconds: number;
        isPaused: boolean;
      }
    | "not-found"
  > {
    const event = await this.getActive(userId, teamId);
    if (!event) return "not-found";

    const now = Date.now();
    const workSeconds = getActiveWorkSeconds(event, now);
    return {
      event: toPublicClockEvent(event),
      workSeconds,
      remainingSeconds: Math.max(0, MAX_WORK_SECONDS_PER_DAY - workSeconds),
      isPaused: typeof event.pausedAt === "number",
    };
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

    // Allow self-service edits for the event owner. Admins can also edit.
    // Future timesheet submission/locking should gate edits at this layer.
    if (event.userId !== requesterId) {
      const adminTeam = await teamsCollection().findOne({
        _id: new ObjectId(event.teamId),
        admins: requesterId,
      });
      if (!adminTeam) return "forbidden";
    }

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

  async deleteEvent(
    requesterId: string,
    clockEventId: string
  ): Promise<"ok" | "not-found" | "forbidden"> {
    if (!isValidId(clockEventId)) return "not-found";

    const coll = clockEventsCollection();
    const event = await coll.findOne({ _id: new ObjectId(clockEventId) });
    if (!event) return "not-found";

    if (event.userId !== requesterId) {
      const adminTeam = await teamsCollection().findOne({
        _id: new ObjectId(event.teamId),
        admins: requesterId,
      });
      if (!adminTeam) return "forbidden";
    }

    await coll.deleteOne({ _id: event._id });
    await attachmentsCollection().deleteMany({
      "attachedTo.kind": "clock",
      "attachedTo.id": clockEventId,
    });

    if (event.endTime === null) {
      broadcast(event.teamId, null);
    }

    return "ok";
  }

  /**
   * Create a completed clock event for a past time range (manual backfill).
   * Requester must be a member of the team. Both times must be in the past.
   */
  async createManual(
    userId: string,
    teamId: string,
    startTime: number,
    endTime: number
  ): Promise<PublicClockEvent | "forbidden" | "invalid-range"> {
    if (!isValidId(teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";

    const now = Date.now();
    if (startTime > now || endTime > now) return "invalid-range";
    if (endTime <= startTime) return "invalid-range";

    const accumulatedTime = Math.floor((endTime - startTime) / 1000);
    const coll = clockEventsCollection();
    const result = await coll.insertOne({
      _id: new ObjectId(),
      userId,
      teamId,
      startTime,
      accumulatedTime,
      breakSegments: [],
      pausedAt: null,
      totalPausedSeconds: 0,
      pauseStartedSessionId: null,
      endTime,
    });

    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return "forbidden";
    return toPublicClockEvent(created);
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
    // Users can always view their own timesheet. Viewing another member's
    // timesheet is restricted to team admins in a shared team.
    if (requesterId !== targetUserId) {
      const sharedAdminTeam = await teamsCollection().findOne({
        admins: requesterId,
        $or: [{ members: targetUserId }, { admins: targetUserId }],
      });
      if (!sharedAdminTeam) return "forbidden";
    }

    const events = await clockEventsCollection()
      .find({ userId: targetUserId, startTime: { $gte: startMs, $lte: endMs } })
      .sort({ startTime: -1 })
      .toArray();

    const sessions = events.map(toPublicClockEvent);
    const completed = sessions.filter((s) => s.endTime !== null);
    const now = Date.now();
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) {
        return sum + getActiveWorkSeconds(s, now);
      }
      const accumulated = s.accumulatedTime ?? 0;
      if (accumulated > 0) return sum + accumulated;
      return sum + Math.max(0, Math.floor((s.endTime - s.startTime) / 1000));
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
