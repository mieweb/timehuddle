import { ObjectId } from "mongodb";
import {
  workItemsCollection,
  timersCollection,
  ticketsCollection,
  teamsCollection,
  profilesCollection,
  usersCollection,
} from "../models/index.js";
import { toId } from "../lib/toId.js";
import { notificationService } from "./notification.service.js";
import type { WorkItem } from "../models/work-item.model.js";
import type { Timer } from "../models/timer.model.js";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── WebSocket Broadcasts ─────────────────────────────────────────────────────

type TimerListener = (userId: string, event: "update") => void;
const timerListeners = new Set<TimerListener>();

export function subscribeToTimerUpdates(fn: TimerListener): () => void {
  timerListeners.add(fn);
  console.log(`[timer.service] Listener subscribed. Total listeners: ${timerListeners.size}`);
  return () => {
    timerListeners.delete(fn);
    console.log(`[timer.service] Listener unsubscribed. Total listeners: ${timerListeners.size}`);
  };
}

function broadcastTimerUpdate(userId: string) {
  console.log(
    `[timer.service] Broadcasting timer update for user ${userId} to ${timerListeners.size} listeners`
  );
  for (const fn of timerListeners) {
    fn(userId, "update");
  }
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

export function toUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

// ─── TimerService ─────────────────────────────────────────────────────────────

export class TimerService {
  /** Notify all team admins when a timesheet entry is created, updated, or deleted. */
  private async notifyTimesheetAdmins(
    actorUserId: string,
    ticketId: string,
    date: string,
    action: "added" | "updated" | "deleted"
  ): Promise<void> {
    if (!isValidId(ticketId)) return;
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket || !isValidId(ticket.teamId)) return;

    const team = await teamsCollection().findOne({ _id: new ObjectId(ticket.teamId) });
    if (!team || !team.admins || team.admins.length === 0) return;

    const profile = await profilesCollection().findOne({ userId: actorUserId, app: "timeharbor" });
    const actorName =
      profile?.displayName ||
      (isValidId(actorUserId)
        ? (await usersCollection().findOne({ _id: toId(actorUserId) as any }))?.name
        : undefined) ||
      "A team member";

    await Promise.all(
      team.admins
        .filter((adminId) => adminId !== actorUserId)
        .map((adminId) =>
          notificationService.create({
            userId: adminId,
            title: "Timesheet Update",
            body: `${actorName} has ${action} a timesheet entry for ${date} in ${team.name}`,
            notificationData: {
              type: "timesheet-entry-changed",
              ticketId,
              date,
              teamId: ticket.teamId,
              userId: actorUserId,
              // Deep-link: lands admin on Teams > Timesheet tab with member pre-selected
              url: `/app/teams?tab=timesheet&memberId=${actorUserId}&teamId=${ticket.teamId}`,
            },
          })
        )
    );
  }

  async createEntry(
    userId: string,
    ticketId: string,
    date: string,
    notifyAdmins = true
  ): Promise<WorkItem | "not-found" | "forbidden"> {
    if (!isValidId(ticketId)) return "not-found";
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return "not-found";

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
    if (notifyAdmins) {
      this.notifyTimesheetAdmins(userId, ticketId, date, "added").catch((err) =>
        console.error("[timer.service] notify admins failed:", err)
      );
    }
    return doc;
  }

  async getOrCreateEntry(
    userId: string,
    ticketId: string,
    date: string
  ): Promise<WorkItem | "not-found" | "forbidden"> {
    if (!isValidId(ticketId)) return "not-found";
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return "not-found";

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
      if ((err as { code?: number }).code === 11000) {
        const found = await workItemsCollection().findOne({ userId, ticketId, date });
        if (found) return found;
      }
      throw err;
    }
  }

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

    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";

    const date = toUtcDateKey(now);

    if (this.isPreviousDate(date)) {
      return "invalid-date";
    }

    const entryResult = await this.getOrCreateEntry(userId, ticketId, date);
    if (entryResult === "not-found" || entryResult === "forbidden") return entryResult;

    let closedSessionId: string | null = null;
    const closeResult = await this._closeRunningSession(userId, now);
    if (closeResult) closedSessionId = closeResult;

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
      broadcastTimerUpdate(userId);
      return { session, closedSessionId };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        const retryClose = await this._closeRunningSession(userId, now);
        if (retryClose) closedSessionId = retryClose;
        const session2: Timer = { ...session, _id: new ObjectId(), createdAt: new Date() };
        await timersCollection().insertOne(session2);
        broadcastTimerUpdate(userId);
        return { session: session2, closedSessionId };
      }
      throw err;
    }
  }

  async startTimerForEntry(
    userId: string,
    entryId: string,
    now: number,
    tz?: string
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

    if (this.isPreviousDate(entry.date, tz)) {
      return { type: "invalid-date" };
    }

    let closedSessionId: string | null = null;
    const closeResult = await this._closeRunningSession(userId, now);
    if (closeResult) closedSessionId = closeResult;

    const session: Timer = {
      _id: new ObjectId(),
      workItemId: entryId,
      userId,
      date: entry.date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
    };

    try {
      await timersCollection().insertOne(session);
      broadcastTimerUpdate(userId);
      return { type: "success", session, closedSessionId };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        const retryClose = await this._closeRunningSession(userId, now);
        if (retryClose) closedSessionId = retryClose;
        const session2: Timer = { ...session, _id: new ObjectId(), createdAt: new Date() };
        await timersCollection().insertOne(session2);
        broadcastTimerUpdate(userId);
        return { type: "success", session: session2, closedSessionId };
      }
      throw err;
    }
  }

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
    const updateResult = await coll.updateOne(
      { _id: new ObjectId(sessionId), endTime: null },
      { $set: { endTime: now, durationSeconds } }
    );

    if (updateResult.modifiedCount === 0) {
      const refetched = await coll.findOne({ _id: new ObjectId(sessionId) });
      if (!refetched) return "not-found";
      if (refetched.endTime !== null) return "already-stopped";
      await coll.updateOne(
        { _id: new ObjectId(sessionId), endTime: null },
        { $set: { endTime: now, durationSeconds } }
      );
    }

    const result = (await coll.findOne({ _id: new ObjectId(sessionId) })) ?? "not-found";
    if (result !== "not-found") broadcastTimerUpdate(userId);
    return result;
  }

  async closeRunningForUser(userId: string, now: number): Promise<string | null> {
    return this._closeRunningSession(userId, now);
  }

  async findClosedAtTime(userId: string, endTime: number): Promise<Timer | null> {
    return timersCollection().findOne({ userId, endTime });
  }

  async restartTimerForWorkItem(
    userId: string,
    workItemId: string,
    now: number
  ): Promise<Timer | null> {
    const workItem = await workItemsCollection().findOne({ _id: new ObjectId(workItemId) });
    if (!workItem) return null;
    const session: Timer = {
      _id: new ObjectId(),
      workItemId,
      userId,
      date: workItem.date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
    };
    await timersCollection().insertOne(session);
    broadcastTimerUpdate(userId);
    return session;
  }

  async getSessionById(sessionId: string): Promise<Timer | null> {
    if (!isValidId(sessionId)) return null;
    return timersCollection().findOne({ _id: new ObjectId(sessionId) });
  }

  async closeAllForUser(userId: string, now: number): Promise<number> {
    const coll = timersCollection();
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

  async getDayEntries(
    userId: string,
    dateStr: string,
    _tz: string
  ): Promise<Array<{ entry: WorkItem; sessions: Timer[] }>> {
    const entries = await workItemsCollection().find({ userId, date: dateStr }).toArray();
    if (entries.length === 0) return [];

    const entryIds = entries.map((entry) => entry._id.toHexString());
    const sessions = await timersCollection()
      .find({ userId, workItemId: { $in: entryIds }, date: dateStr })
      .sort({ startTime: 1 })
      .toArray();

    const sessionsByWorkItemId = new Map<string, Timer[]>();
    for (const session of sessions) {
      const workItemSessions = sessionsByWorkItemId.get(session.workItemId);
      if (workItemSessions) workItemSessions.push(session);
      else sessionsByWorkItemId.set(session.workItemId, [session]);
    }

    return entries.map((entry) => ({
      entry,
      sessions: sessionsByWorkItemId.get(entry._id.toHexString()) ?? [],
    }));
  }

  async getWeekTotals(
    userId: string,
    weekStartDate: string,
    _tz: string
  ): Promise<Array<{ date: string; totalSeconds: number }>> {
    const [year, month, day] = weekStartDate.split("-").map(Number);
    const results: Array<{ date: string; totalSeconds: number }> = [];
    const now = Date.now();

    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(year!, month! - 1, day! + i));
      const dateStr = d.toISOString().slice(0, 10);
      const agg = await timersCollection()
        .aggregate<{ total: number }>([
          { $match: { userId, date: dateStr, endTime: { $ne: null } } },
          { $group: { _id: null, total: { $sum: "$durationSeconds" } } },
        ])
        .toArray();

      const running = await timersCollection().findOne({ userId, date: dateStr, endTime: null });
      const runningSeconds = running ? Math.floor((now - running.startTime) / 1000) : 0;
      results.push({ date: dateStr, totalSeconds: (agg[0]?.total ?? 0) + runningSeconds });
    }

    return results;
  }

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

  async deleteEntry(
    userId: string,
    entryId: string,
    notifyAdmins = true
  ): Promise<{ deletedEntry: boolean; deletedSessions: number } | "not-found" | "forbidden"> {
    if (!isValidId(entryId)) return "not-found";

    const entryObjectId = new ObjectId(entryId);
    const entry = await workItemsCollection().findOne({ _id: entryObjectId });
    if (!entry) return "not-found";
    if (entry.userId !== userId) return "forbidden";

    const sessionsResult = await timersCollection().deleteMany({ workItemId: entryId });
    const entryResult = await workItemsCollection().deleteOne({ _id: entryObjectId, userId });

    broadcastTimerUpdate(userId);
    if (notifyAdmins) {
      this.notifyTimesheetAdmins(userId, entry.ticketId, entry.date, "deleted").catch((err) =>
        console.error("[timer.service] notify admins failed:", err)
      );
    }

    return {
      deletedEntry: entryResult.deletedCount === 1,
      deletedSessions: sessionsResult.deletedCount,
    };
  }

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

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const $unset: Record<string, ""> = {};
    if (updates.ticketId && updates.ticketId !== entry.ticketId) $set.ticketId = updates.ticketId;
    if (updates.note !== undefined) {
      if (updates.note === null || updates.note === "") $unset.note = "";
      else $set.note = updates.note;
    }
    const updateDoc: { $set: Record<string, unknown>; $unset?: Record<string, ""> } = { $set };
    if (Object.keys($unset).length > 0) updateDoc.$unset = $unset;
    await workItemsCollection().updateOne({ _id: entryOid }, updateDoc);

    if (updates.durationSeconds !== undefined) {
      const isRunning = await timersCollection().findOne({ workItemId: entryId, endTime: null });
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

    const updated = await workItemsCollection().findOne({ _id: entryOid });
    if (!updated) return "not-found";
    const finalTicketId =
      updates.ticketId && updates.ticketId !== entry.ticketId ? updates.ticketId : entry.ticketId;
    this.notifyTimesheetAdmins(userId, finalTicketId, updated.date, "updated").catch((err) =>
      console.error("[timer.service] notify admins failed:", err)
    );
    return updated;
  }

  async copyFromPrevious(userId: string, toDate: string): Promise<number> {
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

  async getTeamRunningTimers(
    requestingUserId: string,
    teamId: string
  ): Promise<
    | "not-found"
    | "forbidden"
    | Array<{
        timerId: string;
        workItemId: string;
        userId: string;
        userName: string;
        userImage: string | null;
        ticketId: string;
        ticketTitle: string;
        startTime: number;
      }>
  > {
    if (!isValidId(teamId)) return "not-found";

    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";

    const allMembers = Array.from(new Set([...team.members, ...team.admins]));
    if (!allMembers.includes(requestingUserId)) return "forbidden";

    const tickets = await ticketsCollection()
      .find({ teamId })
      .project<{ _id: ObjectId; title: string }>({ _id: 1, title: 1 })
      .toArray();
    const ticketMap = new Map(tickets.map((t) => [t._id.toHexString(), t.title]));
    const ticketIds = [...ticketMap.keys()];
    if (ticketIds.length === 0) return [];

    const runningWorkItems = await workItemsCollection()
      .find({ ticketId: { $in: ticketIds }, userId: { $in: allMembers } })
      .toArray();
    const workItemIds = runningWorkItems.map((wi) => wi._id.toHexString());
    if (workItemIds.length === 0) return [];

    const runningTimers = await timersCollection()
      .find({ workItemId: { $in: workItemIds }, endTime: null })
      .toArray();
    if (runningTimers.length === 0) return [];

    const userIds = [...new Set(runningTimers.map((t) => t.userId))];
    const [users, profiles] = await Promise.all([
      usersCollection()
        .find({ _id: { $in: userIds.filter(isValidId).map((id) => new ObjectId(id)) } })
        .project<{ _id: ObjectId; name: string; image: string | null }>({
          _id: 1,
          name: 1,
          image: 1,
        })
        .toArray(),
      profilesCollection()
        .find({ userId: { $in: userIds }, app: "timeharbor" })
        .project<{ userId: string; displayName: string; avatar: string | null }>({
          userId: 1,
          displayName: 1,
          avatar: 1,
        })
        .toArray(),
    ]);

    const userNameMap = new Map(users.map((u) => [u._id.toHexString(), u.name]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const workItemMap = new Map(runningWorkItems.map((wi) => [wi._id.toHexString(), wi]));

    return runningTimers.map((timer) => {
      const workItem = workItemMap.get(timer.workItemId);
      const profile = profileMap.get(timer.userId);
      const userName = profile?.displayName || userNameMap.get(timer.userId) || "Unknown";
      const userImage = profile?.avatar ?? null;
      return {
        timerId: timer._id.toHexString(),
        workItemId: timer.workItemId,
        userId: timer.userId,
        userName,
        userImage,
        ticketId: workItem?.ticketId ?? "",
        ticketTitle: workItem ? (ticketMap.get(workItem.ticketId) ?? workItem.ticketId) : "",
        startTime: timer.startTime,
      };
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

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

  private isPreviousDate(date: string, tz?: string): boolean {
    let today: string;
    if (tz) {
      try {
        today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
      } catch {
        today = new Date().toISOString().slice(0, 10);
      }
    } else {
      today = new Date().toISOString().slice(0, 10);
    }
    return date < today;
  }
}

export const timerService = new TimerService();
