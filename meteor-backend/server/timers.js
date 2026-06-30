import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';
import { Timers, WorkItems, Tickets, Teams, isValidId, rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { createNotification, userDisplayName } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublicEntry(e, ticketTitle = null) {
  return {
    id: e._id.toHexString(),
    userId: e.userId,
    ticketId: e.ticketId,
    displayTitle: ticketTitle ?? null,
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
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime ?? null,
    durationSeconds: s.durationSeconds ?? null,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : new Date(s.createdAt).toISOString(),
  };
}

function toUtcDateKey(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function isPreviousDate(date, tz) {
  let today;
  if (tz) {
    try {
      today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    } catch {
      today = new Date().toISOString().slice(0, 10);
    }
  } else {
    today = new Date().toISOString().slice(0, 10);
  }
  return date < today;
}

async function closeRunningSession(userId, now) {
  const running = await Timers.findOneAsync({ userId, endTime: null });
  if (!running) return null;
  const durationSeconds = Math.max(0, Math.floor((now - running.startTime) / 1000));
  await Timers.updateAsync(running._id, { $set: { endTime: now, durationSeconds } });
  return running._id.toHexString();
}

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
            url: `/app/teams?tab=timesheet&memberId=${actorUserId}&teamId=${ticket.teamId}`,
          },
        }).catch(() => {})
      )
  );
}

async function getTicketTitleMap(ticketIds) {
  if (!ticketIds.length) return new Map();
  const tickets = await Tickets.find({
    _id: { $in: ticketIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
  }, { fields: { title: 1 } }).fetchAsync();
  return new Map(tickets.map((t) => [t._id.toHexString(), t.title]));
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
    const ticketIds = [...new Set(entries.map(({ entry }) => entry.ticketId))];
    const titleMap = await getTicketTitleMap(ticketIds);
    return {
      entries: entries.map(({ entry, sessions }) => ({
        entry: toPublicEntry(entry, titleMap.get(entry.ticketId) ?? null),
        sessions: sessions.map(toPublicSession),
      })),
    };
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

    const today = toUtcDateKey(Date.now());
    const entries = await getDayEntries(userId, today);
    const ticketIds = [...new Set(entries.map(({ entry }) => entry.ticketId))];
    const titleMap = await getTicketTitleMap(ticketIds);
    return {
      entries: entries.map(({ entry, sessions }) => ({
        entry: toPublicEntry(entry, titleMap.get(entry.ticketId) ?? null),
        sessions: sessions.map(toPublicSession),
      })),
    };
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

    const runningWorkItems = await WorkItems.find({
      ticketId: { $in: ticketIds },
      userId: { $in: allMembers },
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
    const [meterorUsers, legacyUsers, profiles] = await Promise.all([
      db.collection('users').find({ _id: { $in: userIds.filter(id => !/^[0-9a-f]{24}$/i.test(id)) } }, { projection: { image: 1 } }).toArray(),
      db.collection('user').find({ _id: { $in: userIds.filter(id => /^[0-9a-f]{24}$/i.test(id)).map(id => new ObjectId(id)) } }, { projection: { image: 1 } }).toArray(),
      db.collection('profiles').find({ userId: { $in: userIds }, app: 'timeharbor' }, { projection: { userId: 1, displayName: 1, avatar: 1 } }).toArray(),
    ]);

    const imageMap = new Map([
      ...meterorUsers.map(u => [String(u._id), u.image ?? null]),
      ...legacyUsers.map(u => [u._id.toHexString(), u.image ?? null]),
    ]);
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

  /** Get total seconds for a ticket across all closed sessions. */
  async 'timers.getTicketTotal'({ ticketId } = {}) {
    await requireIdentity(this);
    const entryIds = (await WorkItems.find(
      { ticketId },
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

  /** Get or create a WorkItem for a ticket on a given date. Optionally start a timer. */
  async 'timers.createEntry'({ ticketId, date, note, startNow = false, notifyAdmins = true } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(ticketId)) throw new Meteor.Error('not-found', 'Ticket not found');
    const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
    if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
    if (isValidId(ticket.teamId)) {
      const team = await Teams.findOneAsync({
        _id: new Mongo.ObjectID(ticket.teamId),
        $or: [{ members: userId }, { admins: userId }],
      });
      if (!team) throw new Meteor.Error('forbidden', 'Forbidden');
    }

    // Check if a work item already exists for this user+ticket+date
    let entry = await WorkItems.findOneAsync({ userId, ticketId, date });
    let isNewEntry = false;
    
    if (!entry) {
      // Create new work item only if one doesn't exist
      const entryId = await WorkItems.insertAsync({
        userId,
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
      if (isPreviousDate(date)) throw new Meteor.Error('invalid-date', 'Cannot start a timer on a previous day');
      await closeRunningSession(userId, Date.now());
      const sessionId = await Timers.insertAsync({
        workItemId: entry._id.toHexString(),
        userId,
        date,
        startTime: Date.now(),
        endTime: null,
        createdAt: new Date(),
      });
      session = toPublicSession(await Timers.findOneAsync(sessionId));
    }

    // Only notify admins if we actually created a new entry (not when reusing existing)
    if (notifyAdmins && isNewEntry) {
      notifyTimesheetAdmins(userId, ticketId, date, 'added').catch(() => {});
    }

    return {
      entry: toPublicEntry(entry, ticket.title ?? null),
      session,
    };
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

    const closedSessionId = await closeRunningSession(userId, now);
    const sessionId = await Timers.insertAsync({
      workItemId: entryId,
      userId,
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
  async 'timers.updateEntry'({ entryId, note, durationSeconds, ticketId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(entryId)) throw new Meteor.Error('not-found', 'WorkItem not found');
    const entry = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    if (!entry) throw new Meteor.Error('not-found', 'WorkItem not found');
    if (entry.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');

    if (ticketId && ticketId !== entry.ticketId) {
      if (!isValidId(ticketId)) throw new Meteor.Error('ticket-not-found', 'Ticket not found');
      const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
      if (!ticket) throw new Meteor.Error('ticket-not-found', 'Ticket not found');
      if (isValidId(ticket.teamId)) {
        const team = await Teams.findOneAsync({
          _id: new Mongo.ObjectID(ticket.teamId),
          $or: [{ members: userId }, { admins: userId }],
        });
        if (!team) throw new Meteor.Error('forbidden', 'Forbidden');
      }
    }

    const $set = { updatedAt: new Date() };
    const $unset = {};
    if (ticketId && ticketId !== entry.ticketId) $set.ticketId = ticketId;
    if (note !== undefined) {
      if (note === null || note === '') $unset.note = '';
      else $set.note = note;
    }
    const updateDoc = { $set };
    if (Object.keys($unset).length) updateDoc.$unset = $unset;
    await WorkItems.updateAsync(new Mongo.ObjectID(entryId), updateDoc);

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

    const updated = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    const finalTicketId = ticketId && ticketId !== entry.ticketId ? ticketId : entry.ticketId;
    const updatedTicket = await Tickets.findOneAsync(new Mongo.ObjectID(finalTicketId));
    notifyTimesheetAdmins(userId, finalTicketId, updated.date, 'updated').catch(() => {});
    return { entry: toPublicEntry(updated, updatedTicket?.title ?? null) };
  },

  /** Delete a WorkItem and all its timers. */
  async 'timers.deleteEntry'({ entryId, notifyAdmins = true } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(entryId)) throw new Meteor.Error('not-found', 'WorkItem not found');
    const entry = await WorkItems.findOneAsync(new Mongo.ObjectID(entryId));
    if (!entry) throw new Meteor.Error('not-found', 'WorkItem not found');
    if (entry.userId !== userId) throw new Meteor.Error('forbidden', 'Forbidden');
    const deletedSessions = await Timers.removeAsync({ workItemId: entryId });
    await WorkItems.removeAsync(new Mongo.ObjectID(entryId));
    if (notifyAdmins) {
      notifyTimesheetAdmins(userId, entry.ticketId, entry.date, 'deleted').catch(() => {});
    }
    return { deletedEntry: true, deletedSessions };
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

    const sig = (e) => `${e.ticketId}::${e.note ?? ''}::${e.sortOrder ?? ''}`;
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
    
    // Fetch WorkItems to get ticket IDs
    const workItems = await WorkItems.find({
      _id: { $in: workItemIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
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
