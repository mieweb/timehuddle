/**
 * Tickets feature — Meteor methods removed in Phase 4 (moved to timecore /v1/tickets).
 * Collection + publications remain until ClockPage migrates (Phase 5).
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import type { TicketDoc } from './schema';

export { type TicketDoc } from './schema';
export type {
  CreateTicketInput,
  UpdateTicketInput,
  TicketTimerInput,
  BatchUpdateStatusInput,
  AssignTicketInput,
} from './schema';

// ─── Collection ───────────────────────────────────────────────────────────────

export const Tickets = new Mongo.Collection<TicketDoc>('tickets');

// ─── Publications ─────────────────────────────────────────────────────────────

if (Meteor.isServer) {
  Meteor.publish('teamTickets', function (teamIds: string[]) {
    if (!this.userId) return this.ready();
    if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();
    return Tickets.find({ teamId: { $in: teamIds } });
  });
}

