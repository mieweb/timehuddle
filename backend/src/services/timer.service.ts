import { ObjectId } from "mongodb";
import {
  timeEntriesCollection,
  timerSessionsCollection,
  ticketsCollection,
  teamsCollection,
} from "../models/index.js";
import type { TimeEntry } from "../models/time-entry.model.js";
import type { TimerSession } from "../models/timer-session.model.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── Public shapes ────────────────────────────────────────────────────────────

export function toPublicEntry(e: TimeEntry) {
  return {
    id: e._id.toHexString(),
    userId: e.userId,
    ticketId: e.ticketId,
    date: e.date,
    note: e.note ?? null,
    sortOrder: e.sortOrder ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt?.toISOString() ?? null,
  };
}

export function toPublicSession(s: TimerSession) {
  return {
    id: s._id.toHexString(),
    timeEntryId: s.timeEntryId,
    userId: s.userId,
    teamId: s.teamId,
    ticketId: s.ticketId,
    date: s.date,
    clockEventId: s.clockEventId ?? null,
    startTime: s.startTime,
    endTime: s.endTime,
    durationSeconds: s.durationSeconds ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export type PublicEntry = ReturnType<typeof toPublicEntry>;
export type PublicSession = ReturnType<typeof toPublicSession>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a local YYYY-MM-DD string in a given IANA timezone to the UTC epoch
 * ms range [start, end) that covers that local day.
 */
function localDayBounds(dateStr: string, tz: string): { start: number; end: number } {
  // Find epoch ms for local midnight in `tz` via Intl probe-and-shift.
  const isoMidnight = `${dateStr}T00:00:00`;
  const probe = new Date(isoMidnight + "Z"); // treat as UTC first
  const offset = getUtcOffsetMs(probe, tz);
  const startMs = probe.getTime() - offset;

  // End = start + 24 h (handles DST: compute offset at end too)
  const endProbe = new Date(startMs + 24 * 3600 * 1000);
  const endOffset = getUtcOffsetMs(endProbe, tz);
  return { start: startMs, end: startMs + 24 * 3600 * 1000 - (endOffset - offset) };
}

/**
 * Returns the UTC offset in milliseconds for a Date in a given IANA timezone.
 * A positive offset means UTC is ahead (e.g. UTC+5 → offset = -5h ms).
 */
function getUtcOffsetMs(date: Date, tz: string): number {
  // Format the date in the target TZ and in UTC, then diff.
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const localDate = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour").replace("24", "00")}:${get("minute")}:${get("second")}Z`
  );
  return date.getTime() - localDate.getTime();
}

/** Convert epoch ms to a UTC "YYYY-MM-DD" date key. */
export function toUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ─── TimerService ─────────────────────────────────────────────────────────────

export class TimerService {
  /**
   * Find or create a TimeEntry for { userId, ticketId, date }.
   * Returns "not-found" if the ticket does not exist or "forbidden" if the user
   * is not a member of the ticket's team.
   */
  async getOrCreateEntry(
    userId: string,
    ticketId: string,
    date: string // UTC "YYYY-MM-DD"
  ): Promise<TimeEntry | "not-found" | "forbidden"> {
    if (!isValidId(ticketId)) return "not-found";
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return "not-found";

    // Verify user belongs to the ticket's team
    if (isValidId(ticket.teamId)) {
      const team = await teamsCollection().findOne({
        _id: new ObjectId(ticket.teamId),
        $or: [{ members: userId }, { admins: userId }],
      });
      if (!team) return "forbidden";
    }

    const existing = await timeEntriesCollection().findOne({ userId, ticketId, date });
    if (existing) return existing;

    const doc: TimeEntry = {
      _id: new ObjectId(),
      userId,
      ticketId,
      date,
      createdAt: new Date(),
    };
    try {
      await timeEntriesCollection().insertOne(doc);
      return doc;
    } catch (err: unknown) {
      // E11000 — race condition: another request created it first
      if ((err as { code?: number }).code === 11000) {
        const found = await timeEntriesCollection().findOne({ userId, ticketId, date });
        if (found) return found;
      }
      throw err;
    }
  }

  /**
   * Start a timer for a ticket.
   *
   * - Closes any running session for this user (compare-and-set, one retry).
   * - Inserts a new open TimerSession.
   * - Enforced at DB level: unique partial index on { userId } where endTime=null.
   */
  async startTimer(
    userId: string,
    ticketId: string,
    now: number,
    clockEventId?: string
  ): Promise<
    | { session: TimerSession; closedSessionId: string | null }
    | "not-found"
    | "forbidden"
    | "already-running"
  > {
    if (!isValidId(ticketId)) return "not-found";
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return "not-found";

    // Verify team membership
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";

    const date = toUtcDateKey(now);

    // Ensure TimeEntry exists
    const entryResult = await this.getOrCreateEntry(userId, ticketId, date);
    if (entryResult === "not-found" || entryResult === "forbidden") return entryResult;

    // Close any running session for this user (compare-and-set)
    let closedSessionId: string | null = null;
    const closeResult = await this._closeRunningSession(userId, now);
    if (closeResult) closedSessionId = closeResult;

    // Insert new open session
    const session: TimerSession = {
      _id: new ObjectId(),
      timeEntryId: entryResult._id.toHexString(),
      userId,
      teamId: ticket.teamId,
      ticketId,
      date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
      ...(clockEventId ? { clockEventId } : {}),
    };

    try {
      await timerSessionsCollection().insertOne(session);
      return { session, closedSessionId };
    } catch (err: unknown) {
      // E11000 — unique partial index violation (another running session exists)
      if ((err as { code?: number }).code === 11000) {
        // Retry: close the running session and insert again
        const retryClose = await this._closeRunningSession(userId, now);
        if (retryClose) closedSessionId = retryClose;
        const session2: TimerSession = {
          ...session,
          _id: new ObjectId(),
          createdAt: new Date(),
        };
        await timerSessionsCollection().insertOne(session2);
        return { session: session2, closedSessionId };
      }
      throw err;
    }
  }

  /**
   * Stop a running timer session.
   *
   * Uses compare-and-set: `updateOne({ _id, endTime: null }, { $set: { endTime, durationSeconds } })`.
   * One retry on zero-rows-modified.
   */
  async stopTimer(
    userId: string,
    sessionId: string,
    now: number
  ): Promise<TimerSession | "not-found" | "forbidden" | "already-stopped"> {
    if (!isValidId(sessionId)) return "not-found";
    const coll = timerSessionsCollection();
    const session = await coll.findOne({ _id: new ObjectId(sessionId) });
    if (!session) return "not-found";
    if (session.userId !== userId) return "forbidden";
    if (session.endTime !== null) return "already-stopped";

    const durationSeconds = Math.max(0, Math.floor((now - session.startTime) / 1000));
    const result = await coll.updateOne(
      { _id: new ObjectId(sessionId), endTime: null },
      { $set: { endTime: now, durationSeconds } }
    );

    if (result.modifiedCount === 0) {
      // Retry once — session may have been closed by clock-out
      const refetched = await coll.findOne({ _id: new ObjectId(sessionId) });
      if (!refetched) return "not-found";
      if (refetched.endTime !== null) return "already-stopped";
      await coll.updateOne(
        { _id: new ObjectId(sessionId), endTime: null },
        { $set: { endTime: now, durationSeconds } }
      );
    }

    return (await coll.findOne({ _id: new ObjectId(sessionId) })) ?? "not-found";
  }

  /**
   * Close ALL running sessions for a user in a single updateMany.
   * Called during clock-out — no multi-collection scan needed.
   */
  async closeAllForUser(userId: string, now: number): Promise<number> {
    const coll = timerSessionsCollection();

    // First collect the running sessions to compute durationSeconds for each
    const running = await coll.find({ userId, endTime: null }).toArray();
    if (running.length === 0) return 0;

    const bulkOps = running.map((s) => ({
      updateOne: {
        filter: { _id: s._id, endTime: null },
        update: {
          $set: {
            endTime: now,
            durationSeconds: Math.max(0, Math.floor((now - s.startTime) / 1000)),
          },
        },
      },
    }));

    const result = await coll.bulkWrite(bulkOps);
    return result.modifiedCount;
  }

  /**
   * List TimeEntries with their sessions for a user on a local calendar day.
   *
   * @param dateStr  Local day in "YYYY-MM-DD"
   * @param tz       IANA timezone string (e.g. "America/New_York")
   */
  async getDayEntries(
    userId: string,
    dateStr: string,
    tz: string
  ): Promise<Array<{ entry: TimeEntry; sessions: TimerSession[] }>> {
    const { start, end } = localDayBounds(dateStr, tz);

    // Use UTC date as a prefilter, then refine with timezone-aware boundaries
    const entries = await timeEntriesCollection().find({ userId, date: dateStr }).toArray();

    const results: Array<{ entry: TimeEntry; sessions: TimerSession[] }> = [];

    for (const entry of entries) {
      const sessions = await timerSessionsCollection()
        .find({
          timeEntryId: entry._id.toHexString(),
          startTime: { $gte: start, $lt: end },
        })
        .sort({ startTime: 1 })
        .toArray();
      results.push({ entry, sessions });
    }

    return results;
  }

  /**
   * Compute per-day totals for a 7-day week.
   *
   * @param weekStartDate  Local Monday in "YYYY-MM-DD"
   * @param tz             IANA timezone
   * Returns an array of 7 { date, totalSeconds } objects (Mon → Sun).
   */
  async getWeekTotals(
    userId: string,
    weekStartDate: string,
    tz: string
  ): Promise<Array<{ date: string; totalSeconds: number }>> {
    const [year, month, day] = weekStartDate.split("-").map(Number);
    const results: Array<{ date: string; totalSeconds: number }> = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(year!, month! - 1, day! + i));
      const dateStr = d.toISOString().slice(0, 10);
      const { start, end } = localDayBounds(dateStr, tz);

      // Sum closed sessions for this user in this local day
      const agg = await timerSessionsCollection()
        .aggregate<{ total: number }>([
          {
            $match: {
              userId,
              startTime: { $gte: start, $lt: end },
              endTime: { $ne: null },
            },
          },
          { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
        ])
        .toArray();

      // Add running session time if any
      const running = await timerSessionsCollection().findOne({ userId, endTime: null });
      const runningSeconds =
        running && running.startTime >= start && running.startTime < end
          ? Math.floor((Date.now() - running.startTime) / 1000)
          : 0;

      results.push({
        date: dateStr,
        totalSeconds: (agg[0]?.total ?? 0) + runningSeconds,
      });
    }

    return results;
  }

  /**
   * Get the total accumulated seconds for a ticket across all closed sessions.
   */
  async getTicketTotal(ticketId: string): Promise<number> {
    const agg = await timerSessionsCollection()
      .aggregate<{ total: number }>([
        { $match: { ticketId, endTime: { $ne: null } } },
        { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
      ])
      .toArray();
    return agg[0]?.total ?? 0;
  }

  /**
   * Copy TimeEntry rows from the most recent previous day that has entries
   * to `toDate`. Skips entries where { userId, ticketId, date: toDate } already
   * exists. Returns the number of new entries created.
   */
  async copyFromPrevious(
    userId: string,
    toDate: string // UTC "YYYY-MM-DD"
  ): Promise<number> {
    // Find the most recent date before toDate that has entries for this user
    const prev = await timeEntriesCollection().findOne(
      { userId, date: { $lt: toDate } },
      { sort: { date: -1 } }
    );
    if (!prev) return 0;

    const prevDate = prev.date;
    const prevEntries = await timeEntriesCollection().find({ userId, date: prevDate }).toArray();
    if (prevEntries.length === 0) return 0;

    let created = 0;
    for (const e of prevEntries) {
      const doc: TimeEntry = {
        _id: new ObjectId(),
        userId,
        ticketId: e.ticketId,
        date: toDate,
        ...(e.note ? { note: e.note } : {}),
        ...(e.sortOrder !== undefined ? { sortOrder: e.sortOrder } : {}),
        createdAt: new Date(),
      };
      try {
        await timeEntriesCollection().insertOne(doc);
        created++;
      } catch (err: unknown) {
        // E11000 — entry already exists for this { userId, ticketId, date }. Skip.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }

    return created;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Close the running session for a user (if any). Returns the closed session _id hex or null. */
  private async _closeRunningSession(userId: string, now: number): Promise<string | null> {
    const coll = timerSessionsCollection();
    const running = await coll.findOne({ userId, endTime: null });
    if (!running) return null;

    const durationSeconds = Math.max(0, Math.floor((now - running.startTime) / 1000));
    await coll.updateOne(
      { _id: running._id, endTime: null },
      { $set: { endTime: now, durationSeconds } }
    );
    return running._id.toHexString();
  }
}

export const timerService = new TimerService();
