import { ObjectId } from "mongodb";

import {
  attachmentsCollection,
  clockEventsCollection,
  teamsCollection,
  usersCollection,
} from "../models/index.js";
import type { ClockBreak, ClockEvent } from "../models/clock.model.js";
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

/** 20-minute threshold: breaks ≥ this are non-compensable meal breaks (deducted). */
const MEAL_BREAK_THRESHOLD_SECONDS = 20 * 60;

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

/**
 * Parse the raw `breaks` field from a MongoDB document into typed ClockBreak entries.
 * Preserves all metadata (type, classificationSource, notes, etc.).
 */
export function toBreakEntries(value: unknown): ClockBreak[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ClockBreak | null => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const startTime = raw["startTime"];
      if (typeof startTime !== "number") return null;
      const endTime = typeof raw["endTime"] === "number" ? raw["endTime"] : null;
      const type = raw["type"] === "rest" || raw["type"] === "meal" ? raw["type"] : undefined;
      const classificationSource =
        raw["classificationSource"] === "auto" || raw["classificationSource"] === "manual"
          ? (raw["classificationSource"] as "auto" | "manual")
          : undefined;
      const notes = typeof raw["notes"] === "string" ? raw["notes"] : undefined;
      const updatedBy = typeof raw["updatedBy"] === "string" ? raw["updatedBy"] : undefined;
      const updatedAt = typeof raw["updatedAt"] === "number" ? raw["updatedAt"] : undefined;
      return { startTime, endTime, type, classificationSource, notes, updatedBy, updatedAt };
    })
    .filter((e): e is ClockBreak => e !== null)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Auto-classify a break based on its duration. */
function classifyBreak(durationSeconds: number): { type: "rest" | "meal"; classificationSource: "auto" } {
  return {
    type: durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? "meal" : "rest",
    classificationSource: "auto",
  };
}

/**
 * Seconds to deduct from shift span for pay purposes.
 * Only closed "meal" breaks or open breaks that have already exceeded 30 min are deducted.
 */
function computeDeductedBreakSeconds(breaks: ClockBreak[], now: number): number {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === "number" ? b.endTime : now;
    if (end <= b.startTime) return sum;
    const durationSeconds = Math.floor((end - b.startTime) / 1000);
    if (typeof b.endTime === "number") {
      // Closed break: use explicit type ("rest" = paid, anything else = deducted)
      return b.type === "rest" ? sum : sum + durationSeconds;
    }
    // Open break: auto-classify by current duration for live display
    return durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? sum + durationSeconds : sum;
  }, 0);
}

/** Total break seconds across all breaks (for display, not pay deduction). */
function computeTotalBreakSeconds(breaks: ClockBreak[], now: number): number {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === "number" ? b.endTime : now;
    if (end <= b.startTime) return sum;
    return sum + Math.floor((end - b.startTime) / 1000);
  }, 0);
}

/**
 * Compute net work seconds for a shift: full span minus deducted (meal) break seconds.
 * No artificial cap — stores the actual hours worked.
 */
export function computeWorkSeconds(
  event: Pick<ClockEvent, "startTime" | "endTime" | "breaks">,
  now: number
): number {
  const shiftEnd = typeof event.endTime === "number" ? event.endTime : now;
  const shiftSpan = Math.max(0, Math.floor((shiftEnd - event.startTime) / 1000));
  const breaks = toBreakEntries((event as unknown as Record<string, unknown>)["breaks"]);
  return Math.max(0, shiftSpan - computeDeductedBreakSeconds(breaks, now));
}

function normalizeBreakEntries(
  breaks: ClockBreak[],
  sessionStart: number,
  sessionEnd: number | null
): ClockBreak[] {
  const clipped = breaks
    .map((b): ClockBreak | null => {
      const start = Math.max(sessionStart, b.startTime);
      const endCap = sessionEnd ?? null;
      const rawEnd = b.endTime;
      const end =
        typeof rawEnd === "number" ? (endCap === null ? rawEnd : Math.min(rawEnd, endCap)) : endCap;

      if (sessionEnd !== null && start >= sessionEnd) return null;
      if (typeof end === "number" && end <= sessionStart) return null;
      if (typeof end === "number" && end <= start) return null;
      return { ...b, startTime: start, endTime: end };
    })
    .filter((b): b is ClockBreak => b !== null)
    .sort((a, b) => a.startTime - b.startTime);

  if (!clipped.length) return [];
  const merged: ClockBreak[] = [];
  for (const current of clipped) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...current });
      continue;
    }
    const prevEnd = prev.endTime;
    const currEnd = current.endTime;
    const overlap = prevEnd === null || current.startTime <= prevEnd;
    if (!overlap) {
      merged.push({ ...current });
      continue;
    }
    if (prevEnd === null) continue;
    if (currEnd === null) {
      prev.endTime = null;
      continue;
    }
    prev.endTime = Math.max(prevEnd, currEnd);
  }
  return merged;
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

  const breaks = toBreakEntries(raw["breaks"]);
  const isPaused = breaks.some((b) => b.endTime === null);

  const now = Date.now();
  const workSeconds = computeWorkSeconds({ startTime, endTime, breaks }, now);
  const deductedBreakSeconds = computeDeductedBreakSeconds(breaks, now);
  const totalBreakSeconds = computeTotalBreakSeconds(breaks, now);

  return {
    id: e._id.toHexString(),
    userId: e.userId,
    teamId: e.teamId,
    startTime,
    accumulatedTime: e.accumulatedTime,
    breaks,
    workSeconds,
    deductedBreakSeconds,
    totalBreakSeconds,
    isPaused,
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
      breaks: [],
      notifiedAt3h: null,
      notifiedAt4h: null,
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
    const coll = clockEventsCollection();
    const event = await coll.findOne({ userId, teamId, endTime: null });
    if (!event) return "not-found";

    const now = Date.now();

    // Close any open timer sessions for this user
    await timerService.closeAllForUser(userId, now);

    // Close any open break with auto-classification
    const rawBreaks = (event as unknown as Record<string, unknown>)["breaks"];
    const breaks = toBreakEntries(rawBreaks);
    const closedBreaks: ClockBreak[] = breaks.map((b) => {
      if (b.endTime !== null) return b;
      const durationSeconds = Math.floor((now - b.startTime) / 1000);
      return { ...b, endTime: now, ...classifyBreak(durationSeconds) };
    });

    // Compute final accumulated time: full shift span minus deducted (meal) breaks
    const shiftSpan = Math.floor((now - event.startTime) / 1000);
    const deducted = computeDeductedBreakSeconds(closedBreaks, now);
    const finalAccumulatedTime = Math.max(0, shiftSpan - deducted);

    await coll.updateOne(
      { _id: event._id },
      {
        $set: {
          endTime: now,
          accumulatedTime: finalAccumulatedTime,
          breaks: closedBreaks,
        },
      }
    );

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

    const rawBreaks = (event as unknown as Record<string, unknown>)["breaks"];
    const breaks = toBreakEntries(rawBreaks);
    if (breaks.some((b) => b.endTime === null)) return "already-paused";

    const now = Date.now();
    const nextBreaks: ClockBreak[] = [...breaks, { startTime: now, endTime: null }];

    // Close any running timer session (not resumed automatically on resume)
    await timerService.closeRunningForUser(userId, now);

    await coll.updateOne(
      { _id: event._id, endTime: null },
      { $set: { breaks: nextBreaks } }
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

    const rawBreaks = (event as unknown as Record<string, unknown>)["breaks"];
    const breaks = toBreakEntries(rawBreaks);
    const openIdx = breaks.findIndex((b) => b.endTime === null);
    if (openIdx === -1) return "not-paused";

    const now = Date.now();
    const openBreak = breaks[openIdx];
    const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
    const classification = classifyBreak(durationSeconds);

    const nextBreaks = breaks.map((b, idx) =>
      idx === openIdx ? { ...b, endTime: now, ...classification } : b
    );

    await coll.updateOne(
      { _id: event._id, endTime: null },
      { $set: { breaks: nextBreaks } }
    );

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
        isPaused: boolean;
      }
    | "not-found"
  > {
    const event = await this.getActive(userId, teamId);
    if (!event) return "not-found";

    const now = Date.now();
    const rawBreaks = (event as unknown as Record<string, unknown>)["breaks"];
    const breaks = toBreakEntries(rawBreaks);
    const workSeconds = computeWorkSeconds(event, now);
    return {
      event: toPublicClockEvent(event),
      workSeconds,
      isPaused: breaks.some((b) => b.endTime === null),
    };
  }

  async updateTimes(
    requesterId: string,
    clockEventId: string,
    data: {
      startTime?: number;
      endTime?: number | null;
      breaks?: Array<{ startTime: number; endTime: number | null; type?: "rest" | "meal"; classificationSource?: "auto" | "manual"; notes?: string }>;
    }
  ): Promise<PublicClockEvent | "not-found" | "forbidden" | "invalid-range"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({ _id: new ObjectId(clockEventId) });
    if (!event) return "not-found";

    // Allow self-service edits for the event owner. Admins can also edit.
    if (event.userId !== requesterId) {
      const adminTeam = await teamsCollection().findOne({
        _id: new ObjectId(event.teamId),
        admins: requesterId,
      });
      if (!adminTeam) return "forbidden";
    }

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

    const existingBreaks = toBreakEntries(
      (event as unknown as Record<string, unknown>)["breaks"] || []
    );
    const requestedBreaks = Array.isArray(data.breaks)
      ? toBreakEntries(data.breaks)
      : existingBreaks;
    const normalizedBreaks = normalizeBreakEntries(requestedBreaks, effectiveStart, effectiveEnd);

    // Auto-classify any closed breaks that lack a type
    const now = Date.now();
    const classifiedBreaks: ClockBreak[] = normalizedBreaks.map((b) => {
      if (b.endTime === null || b.type !== undefined) return b;
      const durationSeconds = Math.floor((b.endTime - b.startTime) / 1000);
      return { ...b, ...classifyBreak(durationSeconds) };
    });

    const $set: Record<string, unknown> = { breaks: classifiedBreaks };
    if (typeof data.startTime === "number") $set.startTime = data.startTime;
    if (data.endTime === null) $set.endTime = null;
    else if (typeof data.endTime === "number") $set.endTime = data.endTime;

    if (effectiveEnd !== null) {
      const deductedSeconds = computeDeductedBreakSeconds(classifiedBreaks, now);
      const spanSeconds = Math.max(0, Math.floor((effectiveEnd - effectiveStart) / 1000));
      $set.accumulatedTime = Math.max(0, spanSeconds - deductedSeconds);
    }

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
      breaks: [],
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
          totalBreakSeconds: number;
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
      .find({
        userId: targetUserId,
        startTime: { $gte: startMs, $lte: endMs },
      })
      .sort({ startTime: -1 })
      .toArray();

    const sessions = events
      .map(toPublicClockEvent)
      .sort((a, b) => b.startTime - a.startTime);
    const completed = sessions.filter((s) => s.endTime !== null);
    const now = Date.now();
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) {
        return sum + computeWorkSeconds(s, now);
      }
      const accumulated = s.accumulatedTime ?? 0;
      if (accumulated > 0) return sum + accumulated;
      return sum + Math.max(0, Math.floor((s.endTime - s.startTime) / 1000));
    }, 0);
    const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
    const totalBreakSeconds = sessions.reduce((sum, s) => {
      const breaks = toBreakEntries(
        (s as unknown as Record<string, unknown>)["breaks"] ?? s.breaks
      );
      return sum + computeTotalBreakSeconds(breaks, now);
    }, 0);
    const uniqueDates = new Set(
      sessions.map((s) => new Date(s.startTime).toISOString().split("T")[0])
    );

    return {
      sessions,
      summary: {
        totalSeconds,
        totalBreakSeconds,
        totalSessions: sessions.length,
        completedSessions: completed.length,
        averageSessionSeconds: avgSeconds,
        workingDays: uniqueDates.size,
      },
    };
  }
}

export const clockService = new ClockService();
