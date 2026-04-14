import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { getUserDisplayName } from '../../lib/userDisplayName';
import { Teams } from '../teams/api';
import {
  clockEventStartSchema,
  clockEventStopSchema,
  clockEventTicketSchema,
  timesheetQuerySchema,
  updateClockEventTimesSchema,
  updateYoutubeLinkSchema,
  type ClockEventDoc,
  type SessionDoc,
} from './schema';

// ─── Collections ──────────────────────────────────────────────────────────────

export const ClockEvents = new Mongo.Collection<ClockEventDoc>('clockevents');
export const Sessions = new Mongo.Collection<SessionDoc>('sessions');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDurationText(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function stopTicketInClockEvent(
  clockEventId: string,
  ticketId: string,
  now: number,
): Promise<void> {
  const clockEvent = await ClockEvents.findOneAsync(clockEventId);
  if (!clockEvent) return;
  const entry = clockEvent.tickets?.find((t) => t.ticketId === ticketId);
  if (!entry || !entry.startTimestamp) return;
  const elapsed = Math.floor((now - entry.startTimestamp) / 1000);
  const prev = entry.accumulatedTime || 0;

  // Close the open session
  const sessions = entry.sessions ?? [];
  const updatedSessions = sessions.map((s) =>
    s.endTimestamp === null ? { ...s, endTimestamp: now } : s,
  );

  await ClockEvents.updateAsync(
    { _id: clockEventId, 'tickets.ticketId': ticketId },
    {
      $set: {
        'tickets.$.accumulatedTime': prev + elapsed,
        'tickets.$.sessions': updatedSessions,
      },
      $unset: { 'tickets.$.startTimestamp': '' },
    },
  );
}

// ─── Server ───────────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  // Lazy import Tickets to avoid circular dependency
  let Tickets: Mongo.Collection<Record<string, unknown>>;
  const getTickets = async () => {
    if (!Tickets) {
      // @ts-expect-error dynamic import for circular dependency avoidance
      const mod = await import('../tickets/api');
      Tickets = mod.Tickets as unknown as Mongo.Collection<Record<string, unknown>>;
    }
    return Tickets;
  };

  Meteor.startup(async () => {
    await ClockEvents.createIndexAsync({ userId: 1, teamId: 1, endTime: 1 });
    await ClockEvents.createIndexAsync({ 'tickets.ticketId': 1 });
    await Sessions.createIndexAsync({ userId: 1, teamId: 1 });

    const methodNames = [
      'clock.start',
      'clock.stop',
      'clock.addTicket',
      'clock.stopTicket',
      'clock.updateYoutubeLink',
      'clock.updateTimes',
      'clock.getTimesheetData',
    ];
    DDPRateLimiter.addRule({ name: (n) => methodNames.includes(n), userId: () => true }, 30, 60_000);

    // Auto-clock-out: end events running 8+ hours (push + inbox parity with timeharbor-old)
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    Meteor.setInterval(async () => {
      try {
        const now = Date.now();
        const cutoff = now - EIGHT_HOURS_MS;
        const stale = await ClockEvents.find({ endTime: null, startTimestamp: { $lt: cutoff } }).fetchAsync();
        if (stale.length === 0) return;

        const TicketsColl = await getTickets();
        const { notifyUser, notifyTeamAdmins, APP_NAME_PUSH, PUSH_ICON } = await import('../../server/push');

        for (const event of stale) {
          try {
            const startTs = event.startTimestamp;
            const prevAcc = event.accumulatedTime || 0;
            const elapsed = Math.floor((now - startTs) / 1000);
            const totalSeconds = prevAcc + elapsed;
            const durationText = formatDurationText(totalSeconds);

            if (event.tickets) {
              for (const t of event.tickets.filter((t) => t.startTimestamp)) {
                await stopTicketInClockEvent(event._id!, t.ticketId, now);
              }
            }

            const running = await TicketsColl.find({
              teamId: event.teamId,
              createdBy: event.userId,
              startTimestamp: { $exists: true },
            }).fetchAsync();
            for (const ticket of running) {
              const telapsed = Math.floor((now - (ticket as any).startTimestamp) / 1000);
              const tprev = (ticket as any).accumulatedTime || 0;
              await TicketsColl.updateAsync(ticket._id!, {
                $set: { accumulatedTime: tprev + telapsed },
                $unset: { startTimestamp: '' },
              });
            }

            await ClockEvents.updateAsync(event._id!, {
              $set: { endTime: new Date(), accumulatedTime: totalSeconds },
            });

            const user = await Meteor.users.findOneAsync(event.userId);
            const userName = getUserDisplayName(user, 'A user');
            const team = await Teams.findOneAsync(event.teamId);
            const teamName = team?.name || 'a team';

            try {
              await notifyUser(event.userId, {
                title: `${APP_NAME_PUSH} - Auto Clock Out`,
                body: `You were automatically clocked out after 8 hours of continuous work to prevent burnout. Total time: ${durationText}`,
                icon: PUSH_ICON,
                badge: PUSH_ICON,
                tag: `auto-clockout-user-${event.userId}-${Date.now()}`,
                data: {
                  type: 'auto-clock-out',
                  userId: event.userId,
                  userName,
                  teamName,
                  teamId: event.teamId,
                  clockEventId: event._id,
                  duration: durationText,
                  autoClockOut: true,
                  url: '/app/tickets',
                },
              });
            } catch (e) {
              console.error('[Push] auto clock-out user notify:', e);
            }

            try {
              const peer = encodeURIComponent(event.userId);
              const tid = encodeURIComponent(event.teamId);
              await notifyTeamAdmins(event.teamId, {
                title: `${APP_NAME_PUSH} - Auto Clock Out`,
                body: `${userName} was automatically clocked out of ${teamName} after ${durationText} (8-hour burnout prevention)`,
                icon: PUSH_ICON,
                badge: PUSH_ICON,
                tag: `auto-clockout-admin-${event.userId}-${Date.now()}`,
                data: {
                  type: 'clock-out',
                  userId: event.userId,
                  userName,
                  teamName,
                  teamId: event.teamId,
                  clockEventId: event._id,
                  duration: durationText,
                  autoClockOut: true,
                  url: `/app/messages?openTeam=${tid}&openPeer=${peer}`,
                },
              });
            } catch (e) {
              console.error('[Push] auto clock-out admin notify:', e);
            }
          } catch (err) {
            console.error(`[Clock] auto clock-out failed for ${event._id}:`, err);
          }
        }
      } catch (err) {
        // Mongo monitor hiccups can happen in dev; don't crash process.
        console.error('[Clock] auto clock-out interval failed:', err);
      }
    }, 60_000);
  });

  // ─── Publications ────────────────────────────────────────────────────────────

  Meteor.publish('clockEventsForUser', function () {
    if (!this.userId) return this.ready();
    return ClockEvents.find({ userId: this.userId });
  });

  Meteor.publish('clockEventsForTeams', function (teamIds: string[]) {
    if (!this.userId) return this.ready();
    if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();
    return ClockEvents.find({ teamId: { $in: teamIds } });
  });

  // ─── Methods ──────────────────────────────────────────────────────────────────

  Meteor.methods({
    async 'clock.start'(fields: { teamId: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = clockEventStartSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { teamId } = result.data;
      // Close any open clock events for this user/team
      await ClockEvents.updateAsync(
        { userId: this.userId, teamId, endTime: null },
        { $set: { endTime: new Date() } },
        { multi: true } as any,
      );
      const clockEventId = await ClockEvents.insertAsync({
        userId: this.userId,
        teamId,
        startTimestamp: Date.now(),
        accumulatedTime: 0,
        tickets: [],
        endTime: null,
      });

      try {
        const { notifyTeamAdmins, APP_NAME_PUSH, PUSH_ICON } = await import('../../server/push');
        const user = await Meteor.users.findOneAsync(this.userId);
        const userName = getUserDisplayName(user, 'A user');
        const team = await Teams.findOneAsync(teamId);
        const teamName = team?.name || 'a team';
        const peer = encodeURIComponent(this.userId);
        const tid = encodeURIComponent(teamId);
        await notifyTeamAdmins(teamId, {
          title: APP_NAME_PUSH,
          body: `${userName} clocked in to ${teamName}`,
          icon: PUSH_ICON,
          badge: PUSH_ICON,
          tag: `clockin-${this.userId}-${Date.now()}`,
          data: {
            type: 'clock-in',
            userId: this.userId,
            userName,
            teamName,
            teamId,
            clockEventId,
            url: `/app/messages?openTeam=${tid}&openPeer=${peer}`,
          },
        });
      } catch (e) {
        console.error('[Push] clock-in notify:', e);
      }

      return clockEventId;
    },

    async 'clock.stop'(fields: { teamId: string; youtubeShortLink?: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = clockEventStopSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { teamId, youtubeShortLink } = result.data;
      const clockEvent = await ClockEvents.findOneAsync({ userId: this.userId, teamId, endTime: null });
      if (!clockEvent) return;

      const now = Date.now();
      // Accumulate time
      if (clockEvent.startTimestamp) {
        const elapsed = Math.floor((now - clockEvent.startTimestamp) / 1000);
        const prev = clockEvent.accumulatedTime || 0;
        await ClockEvents.updateAsync(clockEvent._id!, { $set: { accumulatedTime: prev + elapsed } });
      }
      // Stop all running tickets
      if (clockEvent.tickets) {
        for (const t of clockEvent.tickets.filter((t) => t.startTimestamp)) {
          await stopTicketInClockEvent(clockEvent._id!, t.ticketId, now);
        }
      }
      // Also stop ticket collection timers
      const TicketsColl = await getTickets();
      const running = await TicketsColl.find({
        teamId: clockEvent.teamId,
        createdBy: this.userId,
        startTimestamp: { $exists: true },
      }).fetchAsync();
      for (const ticket of running) {
        const elapsed = Math.floor((now - (ticket as any).startTimestamp) / 1000);
        const prev = (ticket as any).accumulatedTime || 0;
        await TicketsColl.updateAsync(ticket._id!, {
          $set: { accumulatedTime: prev + elapsed },
          $unset: { startTimestamp: '' },
        });
      }
      // End event
      const setFields: Record<string, unknown> = { endTime: new Date() };
      const link = typeof youtubeShortLink === 'string' ? youtubeShortLink.trim() : '';
      if (link) setFields.youtubeShortLink = link;
      await ClockEvents.updateAsync(clockEvent._id!, { $set: setFields });

      let durationText = '';
      if (clockEvent.startTimestamp) {
        const elapsed = Math.floor((now - clockEvent.startTimestamp) / 1000);
        const prev = clockEvent.accumulatedTime || 0;
        durationText = formatDurationText(prev + elapsed);
      }

      try {
        const { notifyTeamAdmins, APP_NAME_PUSH, PUSH_ICON } = await import('../../server/push');
        const user = await Meteor.users.findOneAsync(this.userId);
        const userName = getUserDisplayName(user, 'A user');
        const team = await Teams.findOneAsync(teamId);
        const teamName = team?.name || 'a team';
        const peer = encodeURIComponent(this.userId);
        const tid = encodeURIComponent(teamId);
        await notifyTeamAdmins(teamId, {
          title: APP_NAME_PUSH,
          body: `${userName} clocked out of ${teamName} (${durationText})`,
          icon: PUSH_ICON,
          badge: PUSH_ICON,
          tag: `clockout-${this.userId}-${Date.now()}`,
          data: {
            type: 'clock-out',
            userId: this.userId,
            userName,
            teamName,
            teamId,
            clockEventId: clockEvent._id,
            duration: durationText,
            url: `/app/messages?openTeam=${tid}&openPeer=${peer}`,
          },
        });
      } catch (e) {
        console.error('[Push] clock-out notify:', e);
      }
    },

    async 'clock.addTicket'(fields: { clockEventId: string; ticketId: string; now: number }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = clockEventTicketSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { clockEventId, ticketId, now } = result.data;
      const clockEvent = await ClockEvents.findOneAsync(clockEventId);
      if (!clockEvent) return;
      const existing = clockEvent.tickets?.find((t) => t.ticketId === ticketId);
      if (existing) {
        await ClockEvents.updateAsync(
          { _id: clockEventId, 'tickets.ticketId': ticketId },
          {
            $set: { 'tickets.$.startTimestamp': now },
            $push: { 'tickets.$.sessions': { startTimestamp: now, endTimestamp: null } } as any,
          },
        );
      } else {
        const TicketsColl = await getTickets();
        const ticket = await TicketsColl.findOneAsync(ticketId);
        const initialTime = ticket ? ((ticket as any).accumulatedTime || 0) : 0;
        await ClockEvents.updateAsync(clockEventId, {
          $push: {
            tickets: {
              ticketId,
              startTimestamp: now,
              accumulatedTime: initialTime,
              sessions: [{ startTimestamp: now, endTimestamp: null }],
            },
          } as any,
        });
      }
    },

    async 'clock.stopTicket'(fields: { clockEventId: string; ticketId: string; now: number }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = clockEventTicketSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      await stopTicketInClockEvent(result.data.clockEventId, result.data.ticketId, result.data.now);
    },

    async 'clock.updateYoutubeLink'(fields: { clockEventId: string; youtubeShortLink: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = updateYoutubeLinkSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const clockEvent = await ClockEvents.findOneAsync({ _id: result.data.clockEventId, userId: this.userId });
      if (!clockEvent) throw new Meteor.Error('not-found', 'Clock event not found');
      const link = result.data.youtubeShortLink.trim();
      if (link) {
        await ClockEvents.updateAsync(result.data.clockEventId, { $set: { youtubeShortLink: link } });
      }
    },

    async 'clock.updateTimes'(fields: { clockEventId: string; startTimestamp?: number; endTimestamp?: number | null }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = updateClockEventTimesSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { clockEventId, startTimestamp, endTimestamp } = result.data;
      const clockEvent = await ClockEvents.findOneAsync(clockEventId);
      if (!clockEvent) throw new Meteor.Error('not-found', 'Clock event not found');
      // Must be team admin
      const team = await Teams.findOneAsync({ _id: clockEvent.teamId, admins: this.userId });
      if (!team) throw new Meteor.Error('not-authorized', 'Not authorized');
      if (typeof startTimestamp === 'number' && typeof endTimestamp === 'number' && endTimestamp < startTimestamp) {
        throw new Meteor.Error('validation', 'Clock-out cannot be earlier than clock-in');
      }
      const $set: Record<string, unknown> = {};
      if (typeof startTimestamp === 'number') $set.startTimestamp = startTimestamp;
      if (endTimestamp === null) $set.endTime = null;
      else if (typeof endTimestamp === 'number') $set.endTime = new Date(endTimestamp);
      if (Object.keys($set).length > 0) await ClockEvents.updateAsync(clockEventId, { $set });
    },

    async 'clock.getTimesheetData'(fields: { userId: string; startDate: string; endDate: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = timesheetQuerySchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { userId, startDate, endDate } = result.data;
      // Verify shared team membership
      const userTeams = await Teams.find({ members: this.userId }).fetchAsync();
      const hasPermission = userTeams.some(
        (t) => t.members.includes(userId) || t.admins.includes(userId),
      );
      if (!hasPermission) throw new Meteor.Error('not-authorized', 'Cannot view this user\'s timesheet');

      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59`);
      const events = await ClockEvents.find({
        userId,
        startTimestamp: { $gte: start.getTime(), $lte: end.getTime() },
      }).fetchAsync();

      const sessions = await Promise.all(
        events.map(async (event) => {
          const startTime = new Date(event.startTimestamp);
          const endTime = event.endTime ?? null;
          const duration = endTime ? (endTime.getTime() - startTime.getTime()) / 1000 : null;
          const team = await Teams.findOneAsync(event.teamId);
          return {
            id: event._id,
            date: startTime.toISOString().split('T')[0],
            startTime,
            endTime,
            duration,
            isActive: !endTime,
            teamName: team?.name ?? null,
            teamId: event.teamId,
            accumulatedTime: event.accumulatedTime || 0,
          };
        }),
      );
      sessions.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

      const totalSeconds = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
      const completed = sessions.filter((s) => s.duration != null);
      const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
      const uniqueDates = new Set(sessions.map((s) => s.date));

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
    },
  });
}
