import { ObjectId } from "mongodb";
import {
  workItemsCollection,
  timersCollection,
  ticketsCollection,
  teamsCollection,
} from "../models/index.js";
import type { WorkItem } from "../models/work-item.model.js";
import type { Timer } from "../models/timer.model.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── Public shapes ────────────────────────────────────────────────────────────

export function toPublicEntry(e: WorkItem, ticketTitle?: string | null) {
  return {
    id: e._id.toHexString(),
    userId: e.userId,
    ticketId: e.ticketId,
    displayTitle: ticketTitle ?? null,
    date: e.date,
    note: e.note ?? null,
    sortOrder: e.sortOrder ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt?.toISOString() ?? null,
  };
}

export function toPublicSession(s: Timer) {
  return {
    id: s._id.toHexString(),
    workItemId: s.workItemId,
    userId: s.userId,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    durationSeconds: s.durationSeconds ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export type PublicEntry = ReturnType<typeof toPublicEntry>;
export type PublicSession = ReturnType<typeof toPublicSession>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert epoch ms to a UTC "YYYY-MM-DD" date key. */
export function toUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ─── TimerService ─────────────────────────────────────────────────────────────

export class TimerService {
  /**
   * Create a new WorkItem for { userId, ticketId, date }.
   * Returns "not-found" if the ticket does not exist or "forbidden" if the
   * user is not a member of the ticket's team.
   */
  async createEntry(
    userId: string,
    ticketId: string,
    date: string // UTC "YYYY-MM-DD"
  ): Promise<WorkItem | "not-found" | "forbidden"> {
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

    const doc: WorkItem = {
      _id: new ObjectId(),
      userId,
      ticketId,
      date,
      createdAt: new Date(),
    };
    await workItemsCollection().insertOne(doc);
    return doc;
  }

  /**
   * Find or create a WorkItem for { userId, ticketId, date }.
   * Returns "not-found" if the ticket does not exist or "forbidden" if the user
   * is not a member of the ticket's team.
   */
  async getOrCreateEntry(
    userId: string,
    ticketId: string,
    date: string // UTC "YYYY-MM-DD"
  ): Promise<WorkItem | "not-found" | "forbidden"> {
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

    const existing = await workItemsCollection().findOne({ userId, ticketId, date });
    if (existing) return existing;

    const doc: WorkItem = {
      _id: new ObjectId(),
      userId,
      ticketId,
      date,
      createdAt: new Date(),
    };
    try {
      await workItemsCollection().insertOne(doc);
      return doc;
    } catch (err: unknown) {
      // E11000 — race condition: another request created it first
      if ((err as { code?: number }).code === 11000) {
        const found = await workItemsCollection().findOne({ userId, ticketId, date });
        if (found) return found;
      }
      throw err;
    }
  }

  /**
   * Start a timer for a ticket.
   *
   * - Closes any running timer for this user (compare-and-set, one retry).
   * - Inserts a new open Timer.
   * - Enforced at DB level: unique partial index on { userId } where endTime=null.
   */
  async startTimer(
    userId: string,
    ticketId: string,
    now: number
  ): Promise<
    | { session: Timer; closedSessionId: string | null }
    | "not-found"
    | "forbidden"
    | "already-running"
    | "invalid-date"
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

    // Prevent starting timers on previous days
    if (this.isPreviousDate(date)) {
      return "invalid-date";
    }

    // Ensure WorkItem exists
    const entryResult = await this.getOrCreateEntry(userId, ticketId, date);
    if (entryResult === "not-found" || entryResult === "forbidden") return entryResult;

    // Close any running session for this user (compare-and-set)
    let closedSessionId: string | null = null;
    const closeResult = await this._closeRunningSession(userId, now);
    if (closeResult) closedSessionId = closeResult;

    // Insert new open timer
    const session: Timer = {
      _id: new ObjectId(),
      workItemId: entryResult._id.toHexString(),
      userId,
      date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
    };

    try {
      await timersCollection().insertOne(session);
      return { session, closedSessionId };
    } catch (err: unknown) {
      // E11000 — unique partial index violation (another running timer exists)
      if ((err as { code?: number }).code === 11000) {
        // Retry: close the running timer and insert again
        const retryClose = await this._closeRunningSession(userId, now);
        if (retryClose) closedSessionId = retryClose;
        const session2: Timer = {
          ...session,
          _id: new ObjectId(),
          createdAt: new Date(),
        };
        await timersCollection().insertOne(session2);
        return { session: session2, closedSessionId };
      }
      throw err;
    }
  }

  /**
   * Start a timer for a specific WorkItem.
   *
   * - Validates ownership of the work item.
   * - Closes any currently running timer for the user.
   * - Inserts a new open Timer bound to this exact work item.
   */
  async startTimerForEntry(
    userId: string,
    entryId: string,
    now: number
  ): Promise<
    | { type: "success"; session: Timer; closedSessionId: string | null }
    | { type: "not-found" }
    | { type: "forbidden" }
    | { type: "invalid-date" }
  > {
    if (!isValidId(entryId)) return { type: "not-found" };
    const entry = await workItemsCollection().findOne({ _id: new ObjectId(entryId) });
    if (!entry) return { type: "not-found" };
    if (entry.userId !== userId) return { type: "forbidden" };

    // Prevent starting timers on previous days
    if (this.isPreviousDate(entry.date)) {
      return { type: "invalid-date" };
    }

    let closedSessionId: string | null = null;
    const closeResult = await this._closeRunningSession(userId, now);
    if (closeResult) closedSessionId = closeResult;

    const session: Timer = {
      _id: new ObjectId(),
      workItemId: entryId,
      userId,
      // Keep timer date aligned with the parent WorkItem date invariant.
      date: entry.date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
    };

    try {
      await timersCollection().insertOne(session);
      return { type: "success", session, closedSessionId };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        const retryClose = await this._closeRunningSession(userId, now);
        if (retryClose) closedSessionId = retryClose;
        const session2: Timer = {
          ...session,
          _id: new ObjectId(),
          createdAt: new Date(),
        };
        await timersCollection().insertOne(session2);
        return { type: "success", session: session2, closedSessionId };
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
  ): Promise<Timer | "not-found" | "forbidden" | "already-stopped"> {
    if (!isValidId(sessionId)) return "not-found";
    const coll = timersCollection();
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

  /** Close the currently running timer for a user and return its session id. */
  async closeRunningForUser(userId: string, now: number): Promise<string | null> {
    return this._closeRunningSession(userId, now);
  }

  /** Read a timer session by id, or null if missing/invalid. */
  async getSessionById(sessionId: string): Promise<Timer | null> {
    if (!isValidId(sessionId)) return null;
    return timersCollection().findOne({ _id: new ObjectId(sessionId) });
  }

  /**
   * Close ALL running sessions for a user in a single updateMany.
   * Called during clock-out — no multi-collection scan needed.
   */
  async closeAllForUser(userId: string, now: number): Promise<number> {
    const coll = timersCollection();

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
   * List WorkItems with their timers for a user on a local calendar day.
   *
   * @param dateStr  Local day in "YYYY-MM-DD"
   * @param tz       IANA timezone string (e.g. "America/New_York")
   */
  async getDayEntries(
    userId: string,
    dateStr: string,
    _tz: string
  ): Promise<Array<{ entry: WorkItem; sessions: Timer[] }>> {
    const entries = await workItemsCollection().find({ userId, date: dateStr }).toArray();
    if (entries.length === 0) return [];

    const entryIds = entries.map((entry) => entry._id.toHexString());
    const sessions = await timersCollection()
      .find({
        userId,
        workItemId: { $in: entryIds },
        date: dateStr,
      })
      .sort({ startTime: 1 })
      .toArray();

    const sessionsByWorkItemId = new Map<string, Timer[]>();
    for (const session of sessions) {
      const workItemSessions = sessionsByWorkItemId.get(session.workItemId);
      if (workItemSessions) {
        workItemSessions.push(session);
      } else {
        sessionsByWorkItemId.set(session.workItemId, [session]);
      }
    }

    return entries.map((entry) => ({
      entry,
      sessions: sessionsByWorkItemId.get(entry._id.toHexString()) ?? [],
    }));
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
    _tz: string
  ): Promise<Array<{ date: string; totalSeconds: number }>> {
    const [year, month, day] = weekStartDate.split("-").map(Number);
    const results: Array<{ date: string; totalSeconds: number }> = [];
    const now = Date.now(); // capture once for consistent week totals

    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(year!, month! - 1, day! + i));
      const dateStr = d.toISOString().slice(0, 10);
      // Sum closed timers for this user on this local calendar day (matched by date field)
      const agg = await timersCollection()
        .aggregate<{ total: number }>([
          {
            $match: {
              userId,
              date: dateStr,
              endTime: { $ne: null },
            },
          },
          { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
        ])
        .toArray();

      // Add running timer time if any — match by date field, not epoch bounds
      const running = await timersCollection().findOne({ userId, date: dateStr, endTime: null });
      const runningSeconds = running ? Math.floor((now - running.startTime) / 1000) : 0;

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
    const entryIds = (
      await workItemsCollection()
        .find({ ticketId }, { projection: { _id: 1 } })
        .toArray()
    ).map((e) => e._id.toHexString());

    if (entryIds.length === 0) return 0;

    const agg = await timersCollection()
      .aggregate<{ total: number }>([
        { $match: { workItemId: { $in: entryIds }, endTime: { $ne: null } } },
        { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
      ])
      .toArray();
    return agg[0]?.total ?? 0;
  }

  /**
   * Delete a WorkItem and all of its Timers for the owning user.
   */
  async deleteEntry(
    userId: string,
    entryId: string
  ): Promise<{ deletedEntry: boolean; deletedSessions: number } | "not-found" | "forbidden"> {
    if (!isValidId(entryId)) return "not-found";

    const entryObjectId = new ObjectId(entryId);
    const entry = await workItemsCollection().findOne({ _id: entryObjectId });
    if (!entry) return "not-found";
    if (entry.userId !== userId) return "forbidden";

    const sessionsResult = await timersCollection().deleteMany({ workItemId: entryId });
    const entryResult = await workItemsCollection().deleteOne({ _id: entryObjectId, userId });

    return {
      deletedEntry: entryResult.deletedCount === 1,
      deletedSessions: sessionsResult.deletedCount,
    };
  }

  /**
   * Update a WorkItem's note and/or duration.
   *
   * Duration adjustment (when timer is not running):
   * Scales the last closed timer's durationSeconds so the work item total
   * matches the requested value. Ignored if a timer is currently running.
   */
  async updateEntry(
    userId: string,
    entryId: string,
    updates: { note?: string | null; durationSeconds?: number; ticketId?: string }
  ): Promise<WorkItem | "not-found" | "forbidden" | "ticket-not-found"> {
    if (!isValidId(entryId)) return "not-found";
    const entryOid = new ObjectId(entryId);
    const entry = await workItemsCollection().findOne({ _id: entryOid });
    if (!entry) return "not-found";
    if (entry.userId !== userId) return "forbidden";

    // Validate and authorise new ticket if provided
    if (updates.ticketId && updates.ticketId !== entry.ticketId) {
      if (!isValidId(updates.ticketId)) return "ticket-not-found";
      const ticket = await ticketsCollection().findOne({ _id: new ObjectId(updates.ticketId) });
      if (!ticket) return "ticket-not-found";
      if (isValidId(ticket.teamId)) {
        const team = await teamsCollection().findOne({
          _id: new ObjectId(ticket.teamId),
          $or: [{ members: userId }, { admins: userId }],
        });
        if (!team) return "forbidden";
      }
    }

    // Update note and/or ticket on the WorkItem document in a single write.
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, ""> = {};
    if (updates.ticketId && updates.ticketId !== entry.ticketId) {
      $set.ticketId = updates.ticketId;
    }
    if (updates.note !== undefined) {
      if (updates.note === null || updates.note === "") {
        $unset.note = "";
      } else {
        $set.note = updates.note;
      }
    }
    const updateDoc: { $set: Record<string, unknown>; $unset?: Record<string, ""> } = { $set };
    if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;
    await workItemsCollection().updateOne({ _id: entryOid }, updateDoc);

    // Adjust duration when timer is not running
    if (updates.durationSeconds !== undefined) {
      const isRunning = await timersCollection().findOne({
        workItemId: entryId,
        endTime: null,
      });
      if (!isRunning) {
        const sessions = await timersCollection()
          .find({ workItemId: entryId, endTime: { $ne: null } })
          .sort({ startTime: -1 })
          .toArray();
        if (sessions.length > 0) {
          const otherTotal = sessions
            .slice(1)
            .reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
          const lastDuration = Math.max(0, updates.durationSeconds - otherTotal);
          await timersCollection().updateOne(
            { _id: sessions[0]._id },
            { $set: { durationSeconds: lastDuration } }
          );
        }
      }
    }

    return (await workItemsCollection().findOne({ _id: entryOid }))!;
  }

  /**
   * Copy WorkItem rows from the most recent previous day that has entries
   * to `toDate`. Skips rows that already exist on `toDate` with the same
   * ticketId + note + sortOrder signature, while preserving duplicate rows
   * from the source day. Returns the number of new rows created.
   */
  async copyFromPrevious(
    userId: string,
    toDate: string // UTC "YYYY-MM-DD"
  ): Promise<number> {
    // Find the most recent date before toDate that has work items for this user
    const prev = await workItemsCollection().findOne(
      { userId, date: { $lt: toDate } },
      { sort: { date: -1 } }
    );
    if (!prev) return 0;

    const prevDate = prev.date;
    const prevEntries = await workItemsCollection().find({ userId, date: prevDate }).toArray();
    if (prevEntries.length === 0) return 0;

    const signature = (entry: Pick<WorkItem, "ticketId" | "note" | "sortOrder">) =>
      `${entry.ticketId}::${entry.note ?? ""}::${entry.sortOrder ?? ""}`;

    const existingOnTargetDate = await workItemsCollection()
      .find({ userId, date: toDate }, { projection: { ticketId: 1, note: 1, sortOrder: 1 } })
      .toArray();

    // Track how many existing rows already occupy each signature on the target day.
    // This lets us preserve duplicate rows from prevDate instead of collapsing them.
    const existingSignatureCounts = new Map<string, number>();
    for (const entry of existingOnTargetDate) {
      const key = signature(entry);
      existingSignatureCounts.set(key, (existingSignatureCounts.get(key) ?? 0) + 1);
    }

    let created = 0;
    for (const e of prevEntries) {
      const key = signature(e);
      const remainingExisting = existingSignatureCounts.get(key) ?? 0;
      if (remainingExisting > 0) {
        existingSignatureCounts.set(key, remainingExisting - 1);
        continue;
      }

      const doc: WorkItem = {
        _id: new ObjectId(),
        userId,
        ticketId: e.ticketId,
        date: toDate,
        ...(e.note ? { note: e.note } : {}),
        ...(e.sortOrder !== undefined ? { sortOrder: e.sortOrder } : {}),
        createdAt: new Date(),
      };
      await workItemsCollection().insertOne(doc);
      created++;
    }

    return created;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Close the running timer for a user (if any). Returns the closed timer _id hex or null. */
  private async _closeRunningSession(userId: string, now: number): Promise<string | null> {
    const coll = timersCollection();
    const running = await coll.findOne({ userId, endTime: null });
    if (!running) return null;

    const durationSeconds = Math.max(0, Math.floor((now - running.startTime) / 1000));
    await coll.updateOne(
      { _id: running._id, endTime: null },
      { $set: { endTime: now, durationSeconds } }
    );
    return running._id.toHexString();
  }

  /**
   * Check if the given date is earlier than today.
   */
  private isPreviousDate(date: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    return date < today;
  }
}

export const timerService = new TimerService();
