/**
 * Ticket timers — WorkItems (one row per user + ticket + day) and the Timer
 * sessions inside them.
 *
 * Since Milestone 3 a WorkItem is source-aware: it points at a Huddle ticket or
 * a Redmine issue via `{ source, ticketId }` (see ticket-refs.js), and starting
 * a session requires an active shift, which is what guarantees every session is
 * contained by — and auto-closed with — the shift it belongs to.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';
import { Timers, WorkItems, Tickets, Teams, ClockEvents, isValidId, rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { createNotification, userDisplayName } from './notify-core';
import { requiresApproval, submitChangeRequest } from './timesheet-change-requests';
import {
  HUDDLE,
  normalizeSource,
  refKey,
  resolveTicketRef,
  resolveTicketRefs,
  sourceSelector,
} from './ticket-refs';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {object} e        the stored WorkItem
 * @param {{title: string|null, url: string|null}|null} display  resolved at read
 *   time by ticket-refs.js — never persisted on the row itself.
 */
function toPublicEntry(e, display = null) {
  return {
    id: e._id.toHexString(),
    userId: e.userId,
    source: normalizeSource(e.source),
    ticketId: e.ticketId,
    displayTitle: display?.title ?? null,
    displayUrl: display?.url ?? null,
    date: e.date,
    note: e.note ?? null,
    sortOrder: e.sortOrder ?? null,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : new Date(e.createdAt).toISOString(),
    updatedAt: e.updatedAt ? (e.updatedAt instanceof Date ? e.updatedAt.toISOString() : new Date(e.updatedAt).toISOString()) : null,
  };
}

function toPublicSession(s) {
  return {
    id: s._id.toHexString(),
    workItemId: s.workItemId,
    userId: s.userId,
    clockEventId: s.clockEventId ?? null,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime ?? null,
    durationSeconds: s.durationSeconds ?? null,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date(s.createdAt).toISOString(),
  };
}

/** "YYYY-MM-DD" for the given tz (IANA name), falling back to UTC if tz is
 * missing/invalid — must match the client's `date` computation (also local),
 * or WorkItems created "today" locally silently vanish from UTC-bucketed
 * lookups for hours around midnight in any timezone behind UTC. */
function todayInTz(tz) {
  if (tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    } catch {
      // fall through to UTC
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function isPreviousDate(date, tz) {
  return date < todayInTz(tz);
}

async function closeRunningSession(userId, now) {
  const running = await Timers.findOneAsync({ userId, endTime: null });
  if (!running) return null;
  const durationSeconds = Math.max(0, Math.floor((now - running.startTime) / 1000));
  await Timers.updateAsync(running._id, { $set: { endTime: now, durationSeconds } });
  return running._id.toHexString();
}

/**
 * The caller's running shift, or a hard stop.
 *
 * A ticket timer may only run inside a shift (M3 D3). That is what lets the
 * existing 8h auto-clockout close ticket sessions for free, and what lets the
 * Dashboard timesheet nest a session under the shift that contains it.
 * Source-agnostic on purpose: it works the same for a Huddle team and a
 * personal workspace.
 */
async function requireActiveShift(userId) {
  const shift = await ClockEvents.findOneAsync({ userId, endTime: null });
  if (!shift) throw new Meteor.Error('no-active-shift', 'Clock in to start a ticket timer');
  return shift._id.toHexString();
}

/** Admin timesheet notifications are a Huddle-team concept; Redmine has no team. */
async function notifyTimesheetAdmins(actorUserId, ticketId, date, action) {
  if (!isValidId(ticketId)) return;
  const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
  if (!ticket || !isValidId(ticket.teamId)) return;
  const team = await Teams.findOneAsync(new Mongo.ObjectID(ticket.teamId));
  if (!team || !team.admins || team.admins.length === 0) return;
  const actorName = await userDisplayName(actorUserId);
  await Promise.all(
    team.admins
      .filter((adminId) => adminId !== actorUserId)
      .map((adminId) =>
        createNotification({
          userId: adminId,
          title: 'Timesheet Update',
          body: `${actorName} has ${action} a timesheet entry for ${date} in ${team.name}`,
          data: {
            type: 'timesheet-entry-changed',
            ticketId,
            date,
            teamId: ticket.teamId,
            userId: actorUserId,
            url: `/app/dashboard?tab=timesheet&memberId=${actorUserId}&teamId=${ticket.teamId}`,
          },
        }).catch(() => {})
      )
  );
}

/** Shape a day's entries + sessions for the wire, resolving titles in one batch. */
async function toPublicDay(userId, entries) {
  const display = await resolveTicketRefs(
    userId,
    entries.map(({ entry }) => entry),
  );
  return entries.map(({ entry, sessions }) => ({
    entry: toPublicEntry(entry, display.get(refKey(normalizeSource(entry.source), entry.ticketId))),
    sessions: sessions.map(toPublicSession),
  }));
}

/** The team that owns a ticket. Null when the ticket is untracked or gone. */
export async function teamForTicket(ticketId) {
  if (!isValidId(ticketId)) return null;
  const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
  if (!ticket || !isValidId(ticket.teamId)) return null;
  return Teams.findOneAsync(new Mongo.ObjectID(ticket.teamId));
}

/** The team that owns a work item, via its ticket. Null when untracked. */
export async function teamForEntry(entry) {
  return teamForTicket(entry?.ticketId);
}

/** Total logged seconds across a work item's completed sessions. */
async function loggedSeconds(entryId) {
  const sessions = await Timers.find({ workItemId: entryId, endTime: { $ne: null } }).fetchAsync();
  return sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
}

// ─── Mutations ───────────────────────────────────────────────────────────────
// Extracted so an approved change request can replay the same write the direct
// path would have made. `actorId` is who the change is attributed to — the
// requester, even when an admin is the one approving it.

/**
 * Apply a note/duration/ticket change to a work item.
 *
 * `onCommit` fires immediately before the first write — see applyClockUpdate.
 */
export async function applyTimerUpdate(
  entry,
  { note, durationSeconds, ticketId },
  actorId,
  { notifyAdmins = true, onCommit } = {}
) {
  const entryId = entry._id.toHexString();
  const $set = { updatedAt: new Date() };
  const $unset = {};
  if (ticketId && ticketId !== entry.ticketId) {
    // Retargeting always picks a Huddle ticket, so a Redmine entry moved this
    // way becomes a Huddle one and must stop being matched by `sourceSelector`.
    $set.ticketId = ticketId;
    $set.source = HUDDLE;
  }
  if (note !== undefined) {
    if (note === null || note === '') $unset.note = '';
    else $set.note = note;
  }
  const updateDoc = { $set };
  if (Object.keys($unset).length) updateDoc.$unset = $unset;
  onCommit?.();
  await WorkItems.updateAsync(entry._id, updateDoc);

  if (durationSeconds !== undefined) {
    const isRunning = await Timers.findOneAsync({ workItemId: entryId, endTime: null });
    if (!isRunning) {
      const sessions = await Timers.find(
        { workItemId: entryId, endTime: { $ne: null } },
        { sort: { startTime: -1 } }
      ).fetchAsync();
      if (sessions.length > 0) {
        const otherTotal = sessions.slice(1).reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
        const lastDuration = Math.max(0, durationSeconds - otherTotal);
        await Timers.updateAsync(sessions[0]._id, { $set: { durationSeconds: lastDuration } });
      }
    }
  }

  const updated = await WorkItems.findOneAsync(entry._id);
  const finalSource = normalizeSource(updated.source);
  // Source-aware title/link: a Redmine entry has no row in `Tickets`, so its
  // subject comes from the instance instead.
  const display = await resolveTicketRefs(actorId, [updated]);
  // Timesheet admins are a Huddle team concept; a Redmine entry has no team.
  if (notifyAdmins && finalSource === HUDDLE) {
    notifyTimesheetAdmins(actorId, updated.ticketId, updated.date, 'updated').catch(() => {});
  }
  return { entry: toPublicEntry(updated, display.get(refKey(finalSource, updated.ticketId))) };
}

/** Delete a work item and every timer session under it. */
export async function applyTimerDelete(entry, actorId, notifyAdmins = true, onCommit) {
  const entryId = entry._id.toHexString();
  onCommit?.();
  const deletedSessions = await Timers.removeAsync({ workItemId: entryId });
  await WorkItems.removeAsync(entry._id);
  // Huddle-only: a Redmine entry has no team, so it has no timesheet admins.
  if (notifyAdmins && normalizeSource(entry.source) === HUDDLE) {
    notifyTimesheetAdmins(actorId, entry.ticketId, entry.date, 'deleted').catch(() => {});
  }
  return { deletedEntry: true, deletedSessions };
}

async function getDayEntries(userId, dateStr) {
  const entries = await WorkItems.find({ userId, date: dateStr }).fetchAsync();
  if (!entries.length) return [];
  const entryIds = entries.map((e) => e._id.toHexString());
  const sessions = await Timers.find(
    { userId, workItemId: { $in: entryIds }, date: dateStr },
    { sort: { startTime: 1 } }
  ).fetchAsync();
  const sessionsByWorkItem = new Map();
  for (const s of sessions) {
    const arr = sessionsByWorkItem.get(s.workItemId) ?? [];
    arr.push(s);
    sessionsByWorkItem.set(s.workItemId, arr);
  }
  return entries.map((e) => ({
    entry: e,
    sessions: sessionsByWorkItem.get(e._id.toHexString()) ?? [],
  }));
}

// ─── Methods ──────────────────────────────────────────────────────────────────

Meteor.methods({
  /** Get entries + sessions for a calendar day (YYYY-MM-DD). */
  async 'timers.getDay'({ date, tz = 'UTC' } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const entries = await getDayEntries(userId, date);
    return { entries: await toPublicDay(userId, entries) };
  },

  /** Get entries + sessions for today. Admin can pass userId. */
  async 'timers.getToday'({ tz = 'UTC', userId: targetUserId } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    let userId = requesterId;

    if (targetUserId && targetUserId !== requesterId) {
      const adminTeam = await Teams.findOneAsync({
        admins: requesterId,
        $or: [{ members: targetUserId }, { admins: targetUserId }],
      });
      if (!adminTeam) throw new Meteor.Error('forbidden', 'Forbidden');
      userId = targetUserId;
    }

    const today = todayInTz(tz);
    const entries = await getDayEntries(userId, today);
    // Titles resolve against the *target* user's Redmine key, since the issues
    // are only reachable through the key that logged the time.
    return { entries: await toPublicDay(userId, entries) };
  },

  /** Get per-day totals for a 7-day week starting at date (YYYY-MM-DD). */
  async 'timers.getWeek'({ date, tz = 'UTC' } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const [year, month, day] = date.split('-').map(Number);
    const now = Date.now();
    const results = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.UTC(year, month - 1, day + i));
      const dateStr = d.toISOString().slice(0, 10);
      const db = rawDb();
      const agg = await db.collection('timers').aggregate([
        { $match: { userId, date: dateStr, endTime: { $ne: null } } },
        { $group: { _id: null, total: { $sum: '$durationSeconds' } } },
      ]).toArray();
      const running = await Timers.findOneAsync({ userId, date: dateStr, endTime: null });
      const runningSeconds = running ? Math.floor((now - running.startTime) / 1000) : 0;
      results.push({ date: dateStr, totalSeconds: (agg[0]?.total ?? 0) + runningSeconds });
    }
    return { days: results };
  },

  /** Get the current user's running timer or null. */
  async 'timers.getRunning'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const session = await Timers.findOneAsync({ userId, endTime: null });
    return { session: session ? toPublicSession(session) : null };
  },

  /** Get all running timers for members of a team. */
  async 'timers.getTeamRunning'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Team not found');
    const team = await rawDb().collection('teams').findOne({ _id: new ObjectId(teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    const allMembers = Array.from(new Set([...(team.members ?? []), ...(team.admins ?? [])]));
    if (!allMembers.includes(userId)) throw new Meteor.Error('forbidden', 'Forbidden');

    const tickets = await Tickets.find(
      { teamId },
      { fields: { title: 1 } }
    ).fetchAsync();
    const ticketMap = new Map(tickets.map((t) => [t._id.toHexString(), t.title]));
    const ticketIds = [...ticketMap.keys()];
    if (!ticketIds.length) return { timers: [] };

    // Team-scoped by definition, so Huddle-sourced only: a Redmine WorkItem is
    // personal to its owner's API key and has no team to surface it under.
    const runningWorkItems = await WorkItems.find({
      ticketId: { $in: ticketIds },
      userId: { $in: allMembers },
      ...sourceSelector(HUDDLE),
    }).fetchAsync();
    const workItemIds = runningWorkItems.map((wi) => wi._id.toHexString());
    if (!workItemIds.length) return { timers: [] };

    const runningTimers = await Timers.find({
      workItemId: { $in: workItemIds },
      endTime: null,
    }).fetchAsync();
    if (!runningTimers.length) return { timers: [] };

    const userIds = [...new Set(runningTimers.map((t) => t.userId))];
    const db = rawDb();
    const [users, profiles] = await Promise.all([
      db.collection('users').find({ _id: { $in: userIds.map(String) } }, { projection: { image: 1 } }).toArray(),
      db.collection('profiles').find({ userId: { $in: userIds }, app: 'timeharbor' }, { projection: { userId: 1, displayName: 1, avatar: 1 } }).toArray(),
    ]);

    const imageMap = new Map(users.map(u => [String(u._id), u.image ?? null]));
    const profileMap = new Map(profiles.map((p) => [p.userId, p]));
    const workItemMap = new Map(runningWorkItems.map((wi) => [wi._id.toHexString(), wi]));

    const names = await Promise.all(userIds.map(id => userDisplayName(id)));
    const nameMap = new Map(userIds.map((id, i) => [id, names[i]]));

    return {
      timers: runningTimers.map((timer) => {
        const workItem = workItemMap.get(timer.workItemId);
        const profile = profileMap.get(timer.userId);
        return {
          timerId: timer._id.toHexString(),
          workItemId: timer.workItemId,
          userId: timer.userId,
          userName: profile?.displayName || nameMap.get(timer.userId) || 'Unknown',
          userImage: profile?.avatar ?? imageMap.get(timer.userId) ?? null,
          ticketId: workItem?.ticketId ?? '',
          ticketTitle: workItem ? (ticketMap.get(workItem.ticketId) ?? '') : '',
          startTime: timer.startTime,
        };
      }),
    };
  },

  /**
   * Get the caller's own total seconds for a ticket across all closed sessions.
   * Scoped to the caller: unscoped, any user could read everyone's time on any ticket.
   */
  async 'timers.getTicketTotal'({ ticketId, source } = {}) {
    const { userId } = await requireIdentity(this);
    const entryIds = (await WorkItems.find(
      { userId, ticketId, ...sourceSelector(normalizeSource(source)) },
      { fields: { _id: 1 } }
    ).fetchAsync()).map((e) => e._id.toHexString());
    if (!entryIds.length) return { totalSeconds: 0 };
    const db = rawDb();
    const agg = await db.collection('timers').aggregate([
      { $match: { workItemId: { $in: entryIds }, endTime: { $ne: null } } },
      { $group: { _id: null, total: { $sum: '$durationSeconds' } } },
    ]).toArray();
    return { totalSeconds: agg[0]?.total ?? 0 };
  },

  /**
   * Get or create a WorkItem for a ticket on a given date. Optionally start a timer.
   *
   * `source` defaults to Huddle so existing callers are unchanged; My Board
   * passes the row's own source. The uniqueness key is
   * `{userId, source, ticketId, date}` — without `source`, Redmine issue #42
   * and a Huddle ticket would share a row.
   */
  async 'timers.createEntry'({ ticketId, source, date, note, startNow = false, notifyAdmins = true, tz } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticketSource = normalizeSource(source);
    if (typeof ticketId !== 'string' || !ticketId) {
      throw new Meteor.Error('not-found', 'Ticket not found');
    }
    const display = await resolveTicketRef(userId, ticketSource, ticketId);

    // Check if a work item already exists for this user+source+ticket+date
    let entry = await WorkItems.findOneAsync({
      userId,
      ticketId,
      date,
      ...sourceSelector(ticketSource),
    });
    let isNewEntry = false;

    if (!entry) {
      // Create new work item only if one doesn't exist
      const entryId = await WorkItems.insertAsync({
        userId,
        source: ticketSource,
        ticketId,
        date,
        ...(note ? { note } : {}),
        createdAt: new Date(),
      });
      entry = await WorkItems.findOneAsync(entryId);
      isNewEntry = true;
    } else if (note && !entry.note) {
      // Update note if provided and entry doesn't have one yet
      await WorkItems.updateAsync(entry._id, { $set: { note, updatedAt: new Date() } });
      entry = await WorkItems.findOneAsync(entry._id);
    }

    let session = null;
    if (startNow) {
      if (isPreviousDate(date, tz)) throw new Meteor.Error('invalid-date', 'Cannot start a timer on a previous day');
      const clockEventId = await requireActiveShift(userId);
      await closeRunningSession(userId, Date.now());
      const sessionId = await Timers.insertAsync({
        workItemId: entry._id.toHexString(),
        userId,
        clockEventId,
        date,
        startTime: Date.now(),
        endTime: null,
        createdAt: new Date(),
      });
      session = toPublicSession(await Timers.findOneAsync(sessionId));
    }

    // Only notify admins if we actually created a new entry (not when reusing existing)
    if (notifyAdmins && isNewEntry && ticketSource === HUDDLE) {
      notifyTimesheetAdmins(userId, ticketId, date, 'added').catch(() => {});
    }

    return { entry: toPublicEntry(entry, display), session };
  },

  /** Start a timer for a WorkItem. Closes any open timer first. */
  async 'timers.startSession'({ entryId, now = Date.now(), tz } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(entryId)) throw new Meteor.Error('not-found', 'WorkItem not found');
    const entry = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    if (!entry) throw new Meteor.Error('not-found', 'WorkItem not found');
    if (entry.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');
    if (isPreviousDate(entry.date, tz)) throw new Meteor.Error('invalid-date', 'Cannot start a timer on a previous day');

    const clockEventId = await requireActiveShift(userId);
    const closedSessionId = await closeRunningSession(userId, now);
    const sessionId = await Timers.insertAsync({
      workItemId: entryId,
      userId,
      clockEventId,
      date: entry.date,
      startTime: now,
      endTime: null,
      createdAt: new Date(),
    });
    const session = await Timers.findOneAsync(sessionId);
    return { session: toPublicSession(session), closedSessionId };
  },

  /** Stop a running timer session. */
  async 'timers.stopSession'({ sessionId, now = Date.now() } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(sessionId)) throw new Meteor.Error('not-found', 'Session not found');
    const session = await Timers.findOneAsync(new Mongo.ObjectID(sessionId));
    if (!session) throw new Meteor.Error('not-found', 'Session not found');
    if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');
    if (session.endTime !== null) throw new Meteor.Error('already-stopped', 'Session already stopped');
    const durationSeconds = Math.max(0, Math.floor((now - session.startTime) / 1000));
    await Timers.updateAsync(session._id, { $set: { endTime: now, durationSeconds } });
    const updated = await Timers.findOneAsync(session._id);
    return { session: toPublicSession(updated) };
  },

  /** Update a WorkItem's note, duration, and/or ticket. */
  async 'timers.updateEntry'({
    entryId,
    note,
    durationSeconds,
    ticketId,
    description,
    videoUrl,
  } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(entryId)) throw new Meteor.Error('not-found', 'WorkItem not found');
    const entry = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    if (!entry) throw new Meteor.Error('not-found', 'WorkItem not found');
    if (entry.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');

    // Retargeting is Huddle-only: the Work page's ticket picker lists Huddle
    // tickets, and moving logged time onto a *different* Redmine issue is a
    // sync concern (M5), not an edit.
    const retargeting = Boolean(ticketId) && ticketId !== entry.ticketId;
    if (retargeting) {
      try {
        await resolveTicketRef(userId, HUDDLE, ticketId);
      } catch (err) {
        if (err?.error === 'not-found') throw new Meteor.Error('ticket-not-found', 'Ticket not found');
        throw err;
      }
    }

    // Only a change to logged time is a payroll claim. Re-labelling an entry —
    // a note tweak or moving it to the right ticket — stays direct.
    if (durationSeconds !== undefined) {
      const sourceTeam = await teamForEntry(entry);
      // A move lands the time on the destination team's timesheet, so that
      // team's admins are entitled to review it too — gating on the source
      // alone would let a solo-admin team be used to stage the claim.
      const destinationTeam =
        ticketId && ticketId !== entry.ticketId ? await teamForTicket(ticketId) : sourceTeam;
      const reviewingTeam = [destinationTeam, sourceTeam].find((t) =>
        requiresApproval(t, userId)
      );
      if (reviewingTeam) {
        const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(entry.ticketId));
        const request = await submitChangeRequest({
          requesterId: userId,
          team: reviewingTeam,
          kind: 'timer',
          action: 'update',
          targetId: entryId,
          payload: { note, durationSeconds, ticketId },
          baseline: {
            note: entry.note ?? null,
            ticketId: entry.ticketId,
            durationSeconds: await loggedSeconds(entryId),
          },
          label: `${ticket?.title ?? 'a ticket'} — ${entry.date}`,
          description,
          videoUrl,
        });
        return { pending: true, request };
      }
    }

    return applyTimerUpdate(entry, { note, durationSeconds, ticketId }, userId);
  },

  /** Delete a WorkItem and all its timers. */
  async 'timers.deleteEntry'({ entryId, notifyAdmins = true, description, videoUrl } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(entryId)) throw new Meteor.Error('not-found', 'WorkItem not found');
    const entry = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    if (!entry) throw new Meteor.Error('not-found', 'WorkItem not found');
    if (entry.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');

    const team = await teamForEntry(entry);
    if (requiresApproval(team, userId)) {
      // A Redmine entry has no Huddle ticket to name, so fall back to its ref.
      const ticket =
        normalizeSource(entry.source) === HUDDLE
          ? await Tickets.findOneAsync(new Mongo.ObjectID(entry.ticketId))
          : null;
      const request = await submitChangeRequest({
        requesterId: userId,
        team,
        kind: 'timer',
        action: 'delete',
        targetId: entryId,
        payload: { notifyAdmins },
        label: `${ticket?.title ?? `#${entry.ticketId}`} — ${entry.date}`,
        description,
        videoUrl,
      });
      return { pending: true, request };
    }

    return applyTimerDelete(entry, userId, notifyAdmins);
  },

  /** Copy entries from the most recent previous day into toDate. */
  async 'timers.copyPrevious'({ toDate } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const prev = await WorkItems.findOneAsync(
      { userId, date: { $lt: toDate } },
      { sort: { date: -1 } }
    );
    if (!prev) return { created: 0 };
    const prevEntries = await WorkItems.find({ userId, date: prev.date }).fetchAsync();
    if (!prevEntries.length) return { created: 0 };

    const sig = (e) => `${normalizeSource(e.source)}::${e.ticketId}::${e.note ?? ''}::${e.sortOrder ?? ''}`;
    const existing = await WorkItems.find({ userId, date: toDate }).fetchAsync();
    const existingCounts = new Map();
    for (const e of existing) {
      const k = sig(e);
      existingCounts.set(k, (existingCounts.get(k) ?? 0) + 1);
    }

    let created = 0;
    for (const e of prevEntries) {
      const k = sig(e);
      const rem = existingCounts.get(k) ?? 0;
      if (rem > 0) { existingCounts.set(k, rem - 1); continue; }
      await WorkItems.insertAsync({
        userId,
        source: normalizeSource(e.source),
        ticketId: e.ticketId,
        date: toDate,
        ...(e.note ? { note: e.note } : {}),
        ...(e.sortOrder !== undefined ? { sortOrder: e.sortOrder } : {}),
        createdAt: new Date(),
      });
      created++;
    }
    return { created };
  },

  /** Get tickets worked on by user in last 48 hours (for work summary tags). */
  async 'timers.getUserWorkSummary'({ userId } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;

    // Permission check: can view own summary, or teammate can view
    if (userId !== requesterId) {
      // Check if they share a non-personal team
      const sharedTeam = await Teams.findOneAsync({
        isPersonal: { $ne: true },
        $or: [
          { members: requesterId, $or: [{ members: userId }, { admins: userId }] },
          { admins: requesterId, $or: [{ members: userId }, { admins: userId }] },
        ],
      });
      if (!sharedTeam) throw new Meteor.Error('forbidden', 'Forbidden');
    }

    // Query timers from last 48 hours
    const fortyEightHoursAgo = Date.now() - (48 * 60 * 60 * 1000);
    const recentTimers = await Timers.find({
      userId,
      $or: [
        { startTime: { $gte: fortyEightHoursAgo } },
        { endTime: { $gte: fortyEightHoursAgo } },
      ],
    }).fetchAsync();

    if (!recentTimers.length) return { items: [] };

    // Get unique WorkItem IDs
    const workItemIds = [...new Set(recentTimers.map((t) => t.workItemId))];
    
    // Fetch WorkItems to get ticket IDs. Huddle-sourced only: this summary is
    // shown to teammates, and a Redmine issue is private to its owner's key.
    const workItems = await WorkItems.find({
      _id: { $in: workItemIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
      ...sourceSelector(HUDDLE),
    }).fetchAsync();

    const ticketIds = [...new Set(workItems.map((wi) => wi.ticketId).filter(isValidId))];
    if (!ticketIds.length) return { items: [] };

    // Fetch tickets (excluding deleted)
    const tickets = await Tickets.find({
      _id: { $in: ticketIds.map((id) => new Mongo.ObjectID(id)) },
      deleted: { $ne: true },
    }, { fields: { title: 1 } }).fetchAsync();

    return {
      items: tickets.map((t) => ({
        id: t._id.toHexString(),
        title: t.title,
      })),
    };
  },
});

/** Live timer pub for the current user — replaces /v1/timers/ws */
Meteor.publish('timers.liveForUser', async function () {
  if (!this.userId) return this.ready();
  return Timers.find({ userId: this.userId, endTime: null });
});
