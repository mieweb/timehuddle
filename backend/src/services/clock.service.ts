import { ObjectId } from "mongodb";

import {
  attachmentsCollection,
  clockBreaksCollection,
  clockEventsCollection,
  notificationsCollection,
  profilesCollection,
  teamsCollection,
  usersCollection,
} from "../models/index.js";
import type { ClockBreak, ClockBreakInterval, ClockEvent } from "../models/clock.model.js";
import {
  findActiveClockEventByUser,
  findActiveClockEventByUserTeam,
  findBreaksForEvent,
  findBreaksForEvents,
  findClockEventsForUser,
  findLiveClockEventsForTeams,
} from "../models/clock.model.js";
import { timerService } from "./timer.service.js";
import { ActivityType } from "../models/activity.model.js";

import { notificationService } from "./notification.service.js";
import { emitActivity } from "./activity.service.js";
import {
  scheduleClockJobs,
  cancelClockJobs,
  cancelClockJobsByName,
  scheduleAutoClockout,
  rescheduleClockJobs,
} from "./agenda.service.js";

/** 20-minute threshold: breaks ≥ this are non-compensable meal breaks (deducted). */
const MEAL_BREAK_THRESHOLD_SECONDS = 20 * 60;

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

/**
 * Parse raw break input (from API body) into typed ClockBreakInterval entries.
 * Preserves all metadata fields; strips invalid entries; sorts by startTime.
 */
export function toBreakEntries(value: unknown): ClockBreakInterval[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ClockBreakInterval | null => {
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
    .filter((e): e is ClockBreakInterval => e !== null)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Auto-classify a break based on its duration. */
function classifyBreak(durationSeconds: number): {
  type: "rest" | "meal";
  classificationSource: "auto";
} {
  return {
    type: durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? "meal" : "rest",
    classificationSource: "auto",
  };
}

/**
 * Seconds to deduct from shift span for pay purposes.
 * Only closed "meal" breaks or open breaks exceeding the threshold are deducted.
 */
function computeDeductedBreakSeconds(breaks: ClockBreakInterval[], now: number): number {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === "number" ? b.endTime : now;
    if (end <= b.startTime) return sum;
    const durationSeconds = Math.floor((end - b.startTime) / 1000);
    if (typeof b.endTime === "number") {
      return b.type === "rest" ? sum : sum + durationSeconds;
    }
    return durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? sum + durationSeconds : sum;
  }, 0);
}

/** Total break seconds across all breaks (for display, not pay deduction). */
function computeTotalBreakSeconds(breaks: ClockBreakInterval[], now: number): number {
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
  event: Pick<ClockEvent, "startTime" | "endTime">,
  breaks: ClockBreakInterval[],
  now: number
): number {
  const shiftEnd = typeof event.endTime === "number" ? event.endTime : now;
  const shiftSpan = Math.max(0, Math.floor((shiftEnd - event.startTime) / 1000));
  return Math.max(0, shiftSpan - computeDeductedBreakSeconds(breaks, now));
}

function normalizeBreakEntries(
  breaks: ClockBreakInterval[],
  sessionStart: number,
  sessionEnd: number | null
): ClockBreakInterval[] {
  const clipped = breaks
    .map((b): ClockBreakInterval | null => {
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
    .filter((b): b is ClockBreakInterval => b !== null)
    .sort((a, b) => a.startTime - b.startTime);

  if (!clipped.length) return [];
  const merged: ClockBreakInterval[] = [];
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

export function toPublicClockEvent(e: ClockEvent, breaks: ClockBreakInterval[]) {
  // Backwards-compat: documents created before the startTimestamp→startTime rename
  const raw = e as unknown as Record<string, unknown>;
  const startTime =
    typeof e.startTime === "number"
      ? e.startTime
      : typeof raw["startTimestamp"] === "number"
        ? (raw["startTimestamp"] as number)
        : 0;

  const rawEndTime = raw["endTime"];
  const endTime =
    rawEndTime instanceof Date
      ? rawEndTime.getTime()
      : typeof rawEndTime === "number"
        ? rawEndTime
        : null;

  const isPaused = breaks.some((b) => b.endTime === null);
  const now = Date.now();
  const workSeconds = computeWorkSeconds({ startTime, endTime }, breaks, now);
  const deductedBreakSeconds = computeDeductedBreakSeconds(breaks, now);
  const totalBreakSeconds = computeTotalBreakSeconds(breaks, now);

  // Strip internal DB fields (_id, clockEventId) from the public breaks shape
  const publicBreaks: ClockBreakInterval[] = breaks.map((b) => ({
    startTime: b.startTime,
    endTime: b.endTime,
    type: b.type,
    classificationSource: b.classificationSource,
    notes: b.notes,
    updatedBy: b.updatedBy,
    updatedAt: b.updatedAt,
  }));

  return {
    id: e._id.toHexString(),
    userId: e.userId,
    teamId: e.teamId,
    startTime,
    accumulatedTime: e.accumulatedTime,
    breaks: publicBreaks,
    workSeconds,
    deductedBreakSeconds,
    totalBreakSeconds,
    isPaused,
    endTime,
    shiftReminderResponse: e.shiftReminderResponse ?? null,
    shiftAutoClockoutWorkSecs: e.shiftAutoClockoutWorkSecs ?? null,
    shiftNextReminderWorkSecs: e.shiftNextReminderWorkSecs ?? null,
  };
}

export type PublicClockEvent = ReturnType<typeof toPublicClockEvent>;

// ─── ClockService ─────────────────────────────────────────────────────────────

export class ClockService {
  /** Notify all team admins when a clock session is added, updated, or deleted. */
  private async notifyClockAdmins(
    actorUserId: string,
    teamId: string,
    startTime: number,
    action: "added" | "updated" | "deleted"
  ): Promise<void> {
    if (!isValidId(teamId)) return;
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team || !team.admins || team.admins.length === 0) return;

    const profile = await profilesCollection().findOne({ userId: actorUserId, app: "timeharbor" });
    const actorName =
      profile?.displayName ||
      (isValidId(actorUserId)
        ? (await usersCollection().findOne({ _id: new ObjectId(actorUserId) }))?.name
        : undefined) ||
      "A team member";
    const date = new Date(startTime).toISOString().slice(0, 10);

    await Promise.all(
      team.admins.map((adminId) =>
        notificationService.create({
          userId: adminId,
          title: "Timesheet Update",
          body: `${actorName} has ${action} a clock session for ${date} in ${team.name}`,
          notificationData: {
            type: "clock-session-changed",
            teamId,
            date,
          },
        })
      )
    );
  }

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
      autoClockoutAgreed: null,
      endTime: null,
    });

    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return "forbidden";
    const pub = toPublicClockEvent(created, []);
    broadcast(teamId, pub);
    // Schedule 4h break reminder and 7h45m shift-end reminder
    scheduleClockJobs(created._id.toHexString(), userId, teamId, now).catch((err) =>
      console.error("[agenda] scheduleClockJobs failed:", err)
    );

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
              url: `/app/profile/${userId}?tab=work`,
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
    const eventId = event._id.toHexString();
    // Cancel any pending scheduled jobs for this clock session
    cancelClockJobs(eventId).catch((err) => console.error("[agenda] cancelClockJobs failed:", err));

    // Close any open timer sessions for this user
    await timerService.closeAllForUser(userId, now);

    // Close any open break with auto-classification
    const breaks = await findBreaksForEvent(eventId);
    const openBreak = breaks.find((b) => b.endTime === null);
    if (openBreak) {
      const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
      await clockBreaksCollection().updateOne(
        { _id: openBreak._id },
        { $set: { endTime: now, ...classifyBreak(durationSeconds) } }
      );
    }

    // Reload breaks with the open break now closed
    const closedBreaks = await findBreaksForEvent(eventId);

    // Compute final accumulated time: full shift span minus deducted (meal) breaks
    const shiftSpan = Math.floor((now - event.startTime) / 1000);
    const deducted = computeDeductedBreakSeconds(closedBreaks, now);
    const finalAccumulatedTime = Math.max(0, shiftSpan - deducted);

    await coll.updateOne(
      { _id: event._id },
      { $set: { endTime: now, accumulatedTime: finalAccumulatedTime } }
    );

    const updated = await coll.findOne({ _id: event._id });
    if (!updated) return "not-found";
    const pub = toPublicClockEvent(updated, closedBreaks);
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
                url: `/app/profile/${userId}?tab=work`,
              },
            })
            .catch(() => {})
        )
      );

      // Also notify the user who clocked out
      notificationService
        .create({
          userId,
          title: "TiméHuddle",
          body: `You clocked out of ${team.name} (${durationText})`,
          notificationData: {
            type: "clock-out-self",
            teamName: team.name,
            teamId,
            duration: durationText,
            url: `/app/profile/${userId}?tab=work`,
          },
        })
        .catch(() => {});

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

    const breaks = await findBreaksForEvent(event._id.toHexString());
    if (breaks.some((b) => b.endTime === null)) return "already-paused";

    const now = Date.now();

    // Close any running timer session (not resumed automatically on resume)
    await timerService.closeRunningForUser(userId, now);

    await clockBreaksCollection().insertOne({
      _id: new ObjectId(),
      clockEventId: event._id.toHexString(),
      startTime: now,
      endTime: null,
    });

    // Use optimistic in-memory view — avoid extra round-trip
    const updatedBreaks: ClockBreakInterval[] = [...breaks, { startTime: now, endTime: null }];
    const pub = toPublicClockEvent(event, updatedBreaks);
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

    const breaks = await findBreaksForEvent(event._id.toHexString());
    const openBreak = breaks.find((b) => b.endTime === null);
    if (!openBreak) return "not-paused";

    const now = Date.now();
    const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
    const classification = classifyBreak(durationSeconds);

    await clockBreaksCollection().updateOne(
      { _id: openBreak._id },
      { $set: { endTime: now, ...classification } }
    );

    const updatedBreaks: ClockBreakInterval[] = breaks.map((b) =>
      b._id.equals(openBreak._id) ? { ...b, endTime: now, ...classification } : b
    );

    // Restart the timer that was stopped when the break began
    const breakStartTime = openBreak.startTime;
    const closedTimer = await timerService.findClosedAtTime(event.userId, breakStartTime);
    if (closedTimer) {
      await timerService.restartTimerForWorkItem(event.userId, closedTimer.workItemId, now);
    }

    const pub = toPublicClockEvent(event, updatedBreaks);
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
    const breaks = await findBreaksForEvent(event._id.toHexString());
    const workSeconds = computeWorkSeconds(event, breaks, now);
    return {
      event: toPublicClockEvent(event, breaks),
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
      breaks?: Array<{
        startTime: number;
        endTime: number | null;
        type?: "rest" | "meal";
        classificationSource?: "auto" | "manual";
        notes?: string;
      }>;
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

    const existingBreaks = await findBreaksForEvent(clockEventId);
    const requestedBreaks: ClockBreakInterval[] = Array.isArray(data.breaks)
      ? toBreakEntries(data.breaks)
      : existingBreaks;
    const normalizedBreaks = normalizeBreakEntries(requestedBreaks, effectiveStart, effectiveEnd);

    // Auto-classify any closed breaks that lack a type
    const now = Date.now();
    const classifiedBreaks: ClockBreakInterval[] = normalizedBreaks.map((b) => {
      if (b.endTime === null || b.type !== undefined) return b;
      const durationSeconds = Math.floor((b.endTime - b.startTime) / 1000);
      return { ...b, ...classifyBreak(durationSeconds) };
    });

    // Replace all breaks: delete existing + insert new
    await clockBreaksCollection().deleteMany({ clockEventId });
    if (classifiedBreaks.length) {
      await clockBreaksCollection().insertMany(
        classifiedBreaks.map((b) => ({
          _id: new ObjectId(),
          clockEventId,
          ...b,
        }))
      );
    }

    // Update the clock event itself
    const $set: Record<string, unknown> = {};
    if (typeof data.startTime === "number") {
      $set.startTime = data.startTime;
    }
    if (data.endTime === null) $set.endTime = null;
    else if (typeof data.endTime === "number") $set.endTime = data.endTime;

    if (effectiveEnd !== null) {
      const deductedSeconds = computeDeductedBreakSeconds(classifiedBreaks, now);
      const spanSeconds = Math.max(0, Math.floor((effectiveEnd - effectiveStart) / 1000));
      $set.accumulatedTime = Math.max(0, spanSeconds - deductedSeconds);
    }

    if (Object.keys($set).length > 0) await coll.updateOne({ _id: event._id }, { $set });

    // Re-schedule Agenda jobs when startTime changes on an active session
    if (typeof data.startTime === "number" && event.endTime === null) {
      rescheduleClockJobs(
        clockEventId,
        event.userId,
        event.teamId,
        data.startTime,
        event.autoClockoutAgreed === true
      ).catch((err) => console.error("[agenda] rescheduleClockJobs failed:", err));
    }

    const updated = await coll.findOne({ _id: event._id });
    const updatedBreaks = await findBreaksForEvent(clockEventId);
    if (updated) {
      this.notifyClockAdmins(requesterId, event.teamId, updated.startTime, "updated").catch((err) =>
        console.error("[clock.service] notify admins failed:", err)
      );
    }
    return updated ? toPublicClockEvent(updated, updatedBreaks) : "not-found";
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
    // Cancel any pending scheduled jobs and delete all breaks for this event
    cancelClockJobs(clockEventId).catch((err) =>
      console.error("[agenda] cancelClockJobs on delete failed:", err)
    );
    await clockBreaksCollection().deleteMany({ clockEventId });
    await attachmentsCollection().deleteMany({
      "attachedTo.kind": "clock",
      "attachedTo.id": clockEventId,
    });

    if (event.endTime === null) {
      broadcast(event.teamId, null);
    }

    this.notifyClockAdmins(requesterId, event.teamId, event.startTime, "deleted").catch((err) =>
      console.error("[clock.service] notify admins failed:", err)
    );

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
      endTime,
    });

    const created = await coll.findOne({ _id: result.insertedId });
    if (!created) return "forbidden";
    this.notifyClockAdmins(userId, teamId, startTime, "added").catch((err) =>
      console.error("[clock.service] notify admins failed:", err)
    );
    return toPublicClockEvent(created, []);
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

    // Batch-load all breaks in one query
    const eventIds = events.map((e) => e._id.toHexString());
    const allBreaks = await findBreaksForEvents(eventIds);
    const breaksByEventId = new Map<string, ClockBreak[]>();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      breaksByEventId.set(b.clockEventId, arr);
    }

    const now = Date.now();
    const sessions = events
      .map((e) => toPublicClockEvent(e, breaksByEventId.get(e._id.toHexString()) ?? []))
      .sort((a, b) => b.startTime - a.startTime);

    const completed = sessions.filter((s) => s.endTime !== null);
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) {
        const breaks = breaksByEventId.get(s.id) ?? [];
        return sum + computeWorkSeconds(s, breaks, now);
      }
      const accumulated = s.accumulatedTime ?? 0;
      if (accumulated > 0) return sum + accumulated;
      return sum + Math.max(0, Math.floor((s.endTime - s.startTime) / 1000));
    }, 0);
    const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
    const totalBreakSeconds = sessions.reduce((sum, s) => {
      return sum + computeTotalBreakSeconds(s.breaks, now);
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

  /**
   * Mark the user's active clock event as "agreed to clock out".
   * The clock-monitor job will auto-clockout this session when it reaches 8h.
   */
  async agreeAutoClockout(
    userId: string,
    clockEventId: string
  ): Promise<"ok" | "not-found" | "forbidden"> {
    if (!isValidId(clockEventId)) return "not-found";
    const coll = clockEventsCollection();
    const event = await coll.findOne({ _id: new ObjectId(clockEventId) });
    if (!event) return "not-found";
    if (event.userId !== userId) return "forbidden";
    if (event.endTime !== null) return "not-found"; // already clocked out
    await coll.updateOne({ _id: event._id }, { $set: { autoClockoutAgreed: true } });
    // Schedule the 8h auto-clockout job now that the user has agreed.
    // Also cancel the missed-clockout job since the agreed path handles it.
    scheduleAutoClockout(clockEventId, userId, event.teamId, event.startTime).catch((err) =>
      console.error("[agenda] scheduleAutoClockout failed:", err)
    );
    // Cancel the missed-clockout safety net — the agreed job takes over
    cancelClockJobsByName(clockEventId, "shift-missed-clockout").catch(() => {});
    return "ok";
  }
}

export const clockService = new ClockService();

/**
 * Handle a user's agree/disagree response to a shift-end reminder notification.
 * Called from the notifications route: POST /v1/notifications/:id/shift-respond
 *
 * agree   — marks response; shiftAutoClockoutWorkSecs stays → monitor clocks out at 8h mark
 * disagree — clears the 8h threshold; schedules next reminder 2h from now in work-seconds
 */
export async function respondToShiftReminder(
  userId: string,
  notificationId: string,
  action: "agree" | "disagree"
): Promise<"ok" | "not-found" | "forbidden" | "bad-request" | "already-closed"> {
  if (!ObjectId.isValid(notificationId)) return "not-found";

  const notification = await notificationsCollection().findOne({
    _id: new ObjectId(notificationId),
  });
  if (!notification) return "not-found";
  if (notification.userId !== userId) return "forbidden";

  const data = (notification.data ?? {}) as Record<string, unknown>;
  if (data.type !== "shift-end-reminder") return "bad-request";

  const clockEventId = typeof data.clockEventId === "string" ? data.clockEventId : "";
  if (!clockEventId || !ObjectId.isValid(clockEventId)) return "bad-request";

  const coll = clockEventsCollection();
  const event = await coll.findOne({ _id: new ObjectId(clockEventId) });
  if (!event) return "not-found";
  if (event.endTime !== null) return "already-closed";
  if (event.userId !== userId) return "forbidden";

  if (action === "agree") {
    // Mark response — shiftAutoClockoutWorkSecs stays set, monitor will clock out at the threshold.
    // Guard endTime: null so a concurrent auto-clockout doesn't update a closed event.
    const result = await coll.updateOne(
      { _id: event._id, endTime: null },
      { $set: { shiftReminderResponse: "agreed" } }
    );
    if (result.modifiedCount === 0) return "already-closed";
    // Cancel the missed-clockout safety net — the agreed path handles clockout
    cancelClockJobsByName(clockEventId, "shift-missed-clockout").catch(() => {});
  } else {
    // Disagree: cancel the upcoming auto-clockout; schedule next reminder 2h from now (in work-seconds).
    // Guard endTime: null so a concurrent auto-clockout doesn't update a closed event.
    const breaks = await findBreaksForEvent(clockEventId);
    const currentWorkSecs = computeWorkSeconds(event, breaks, Date.now());
    const result = await coll.updateOne(
      { _id: event._id, endTime: null },
      {
        $set: {
          shiftReminderResponse: "disagreed",
          shiftAutoClockoutWorkSecs: null,
          shiftNextReminderWorkSecs: currentWorkSecs + 2 * 3600,
        },
      }
    );
    if (result.modifiedCount === 0) return "already-closed";
    // User chose to continue working — cancel the missed-clockout safety net
    cancelClockJobsByName(clockEventId, "shift-missed-clockout").catch(() => {});
  }

  // Delete the notification after processing
  await notificationsCollection().deleteOne({
    _id: new ObjectId(notificationId),
    userId,
  });

  return "ok";
}
