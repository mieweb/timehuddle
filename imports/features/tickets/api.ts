/**
 * Tickets feature — server-side Meteor API removed in Phase 4.
 * Data is now served by timecore (/v1/tickets).
 */
export type {
  TicketDoc,
  CreateTicketInput,
  UpdateTicketInput,
  TicketTimerInput,
  BatchUpdateStatusInput,
  AssignTicketInput,
} from './schema';

// ─── Server ───────────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  // Lazy import ClockEvents to avoid circular dependency
  let ClockEvents: Mongo.Collection<Record<string, unknown>>;
  const getClockEvents = async () => {
    if (!ClockEvents) {
      const mod = await import('../clock/api');
      ClockEvents = mod.ClockEvents as unknown as Mongo.Collection<Record<string, unknown>>;
    }
    return ClockEvents;
  };

  Meteor.startup(async () => {
    await Tickets.createIndexAsync({ teamId: 1 });
    await Tickets.createIndexAsync({ createdBy: 1 });
    await Tickets.createIndexAsync({ teamId: 1, createdBy: 1 });

    const methodNames = [
      'tickets.create',
      'tickets.update',
      'tickets.delete',
      'tickets.start',
      'tickets.stop',
      'tickets.batchUpdateStatus',
      'tickets.assign',
    ];
    DDPRateLimiter.addRule({ name: (n) => methodNames.includes(n), userId: () => true }, 30, 60_000);
  });

  // ─── Publications ────────────────────────────────────────────────────────────

  Meteor.publish('teamTickets', function (teamIds: string[]) {
    if (!this.userId) return this.ready();
    if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();
    return Tickets.find({ teamId: { $in: teamIds } });
  });

  Meteor.publish('adminTeamTickets', async function (teamId: string) {
    if (!this.userId) return this.ready();
    const team = await Teams.findOneAsync({ _id: teamId, admins: this.userId });
    if (!team) return this.ready();
    return Tickets.find({ teamId });
  });

  // ─── Methods ──────────────────────────────────────────────────────────────────

  Meteor.methods({
    async 'tickets.create'(fields: { teamId: string; title: string; github?: string; accumulatedTime?: number }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = createTicketSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { teamId, title, github, accumulatedTime } = result.data;
      const team = await Teams.findOneAsync({ _id: teamId, members: this.userId });
      if (!team) throw new Meteor.Error('not-authorized', 'Not a member of this team');
      const ticketId = await Tickets.insertAsync({
        teamId,
        title,
        github,
        accumulatedTime,
        createdBy: this.userId,
        assignedTo: this.userId,
        createdAt: new Date(),
      });
      // Add to active clock event if exists
      const CE = await getClockEvents();
      const activeEvent = await CE.findOneAsync({ userId: this.userId, teamId, endTime: null });
      if (activeEvent) {
        await CE.updateAsync(activeEvent._id!, {
          $push: {
            tickets: {
              ticketId,
              startTimestamp: Date.now(),
              accumulatedTime,
              sessions: [{ startTimestamp: Date.now(), endTimestamp: null }],
            },
          } as any,
        });
      }
      return ticketId;
    },

    async 'tickets.update'(fields: { ticketId: string; updates: Record<string, unknown> }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = updateTicketSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { ticketId, updates } = result.data;
      const ticket = await Tickets.findOneAsync(ticketId);
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      if (ticket.createdBy !== this.userId) throw new Meteor.Error('not-authorized', 'Not your ticket');
      const team = await Teams.findOneAsync({ _id: ticket.teamId, members: this.userId });
      if (!team) throw new Meteor.Error('not-authorized', 'Not a member of this team');
      await Tickets.updateAsync(ticketId, { $set: { ...updates, updatedAt: new Date() } });
    },

    async 'tickets.delete'(ticketId: string) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const ticket = await Tickets.findOneAsync(ticketId);
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      if (ticket.createdBy !== this.userId) throw new Meteor.Error('not-authorized', 'Not your ticket');
      // Remove from clock events
      const CE = await getClockEvents();
      await CE.updateAsync(
        { userId: this.userId, teamId: ticket.teamId, 'tickets.ticketId': ticketId },
        { $pull: { tickets: { ticketId } } } as any,
        { multi: true } as any,
      );
      await Tickets.removeAsync(ticketId);
    },

    async 'tickets.start'(fields: { ticketId: string; now: number }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = ticketTimerSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { ticketId, now } = result.data;
      const ticket = await Tickets.findOneAsync(ticketId);
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      if (ticket.createdBy !== this.userId) throw new Meteor.Error('not-authorized', 'Not your ticket');
      await Tickets.updateAsync(ticketId, { $set: { startTimestamp: now } });
    },

    async 'tickets.stop'(fields: { ticketId: string; now: number }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = ticketTimerSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { ticketId, now } = result.data;
      const ticket = await Tickets.findOneAsync(ticketId);
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      if (ticket.createdBy !== this.userId) throw new Meteor.Error('not-authorized', 'Not your ticket');
      if (ticket.startTimestamp) {
        const elapsed = Math.floor((now - ticket.startTimestamp) / 1000);
        const prev = ticket.accumulatedTime || 0;
        await Tickets.updateAsync(ticketId, {
          $set: { accumulatedTime: prev + elapsed },
          $unset: { startTimestamp: '' },
        });
      }
    },

    async 'tickets.batchUpdateStatus'(fields: { ticketIds: string[]; status: string; teamId: string }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = batchUpdateStatusSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { ticketIds, status, teamId } = result.data;
      const team = await Teams.findOneAsync({ _id: teamId, admins: this.userId });
      if (!team) throw new Meteor.Error('not-authorized', 'Not a team admin');
      const updateFields: Record<string, unknown> = { status, updatedAt: new Date(), updatedBy: this.userId };
      if (status === 'reviewed') {
        updateFields.reviewedBy = this.userId;
        updateFields.reviewedAt = new Date();
      }
      return await Tickets.updateAsync(
        { _id: { $in: ticketIds }, teamId },
        { $set: updateFields },
        { multi: true } as any,
      );
    },

    async 'tickets.assign'(fields: { ticketId: string; assignedToUserId: string | null }) {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      const result = assignTicketSchema.safeParse(fields);
      if (!result.success) throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid');
      const { ticketId, assignedToUserId } = result.data;
      const ticket = await Tickets.findOneAsync(ticketId);
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      const team = await Teams.findOneAsync({ _id: ticket.teamId, admins: this.userId });
      if (!team) throw new Meteor.Error('forbidden', 'Only admins can assign tickets');
      if (assignedToUserId) {
        const allIds = [...(team.members || []), ...(team.admins || [])];
        if (!allIds.includes(assignedToUserId)) throw new Meteor.Error('bad-request', 'Assignee must be a team member');
      }
      await Tickets.updateAsync(ticketId, { $set: { assignedTo: assignedToUserId, updatedAt: new Date() } });
    },
  });
}
