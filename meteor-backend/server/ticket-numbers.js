/**
 * Ticket numbers (#689): every ticket gets a number from its organization's
 * counter, and is shown as `<org prefix>-<number>`, e.g. `TH-12`.
 *
 * The prefix lives on the organization and is read at display time, never
 * copied onto tickets, so renaming it relabels every ticket at once. Takes the
 * Mongo `db` and has no Meteor imports, so it is testable
 * (tests/ticket-numbers.test.ts).
 */
import { ObjectId } from 'mongodb';

import { runMigrationOnce } from './migration-claim';

export const DEFAULT_TICKET_PREFIX = 'TH';

/** A letter, then up to five letters or digits. */
const TICKET_PREFIX_RE = /^[A-Z][A-Z0-9]{0,5}$/;

// Where a team with no organization counts from: legacy teams only.
const NO_ORG = 'no-org';

const MARKER_ID = 'ticket-numbers-689';

/** The prefix to store for `input`, or null when it is not a valid one. */
export function normalizeTicketPrefix(input) {
  if (typeof input !== 'string') return null;
  const prefix = input.trim().toUpperCase();
  return TICKET_PREFIX_RE.test(prefix) ? prefix : null;
}

// Legacy orgs can carry non-ObjectId string ids.
function toDocId(id) {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}

/** The next number in `orgId`'s sequence. Every call gets a different one. */
export async function nextTicketNumber(db, orgId) {
  const counter = await db
    .collection('ticket_counters')
    .findOneAndUpdate(
      { _id: orgId || NO_ORG },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
  return counter.seq;
}

/**
 * The ticket prefix of each org in `orgIds`, keyed by org id. An org without
 * one, or a missing org, gets the default.
 */
export async function ticketPrefixesFor(db, orgIds) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const orgs = ids.length
    ? await db
        .collection('organizations')
        .find(
          { _id: { $in: ids.map((id) => toDocId(id)) } },
          { projection: { ticketPrefix: 1 } },
        )
        .toArray()
    : [];
  const byId = new Map(orgs.map((org) => [String(org._id), org.ticketPrefix]));
  return new Map(ids.map((id) => [id, byId.get(id) || DEFAULT_TICKET_PREFIX]));
}

/**
 * Number every ticket that has none, oldest first within each organization.
 * Numbers come from the same counter `tickets.create` uses, so a ticket
 * created while this runs still gets a number nobody else has.
 */
export async function numberExistingTickets(db) {
  const teamOrg = new Map();
  const orgOf = async (teamId) => {
    if (!teamOrg.has(teamId)) {
      const team = await db
        .collection('teams')
        .findOne({ _id: toDocId(teamId) }, { projection: { orgId: 1 } });
      teamOrg.set(teamId, team?.orgId ?? null);
    }
    return teamOrg.get(teamId);
  };
  const tickets = db
    .collection('tickets')
    .find({ number: { $exists: false } }, { projection: { teamId: 1 }, sort: { createdAt: 1, _id: 1 } });
  let numbered = 0;
  for await (const ticket of tickets) {
    const number = await nextTicketNumber(db, await orgOf(ticket.teamId));
    const { modifiedCount } = await db
      .collection('tickets')
      .updateOne({ _id: ticket._id, number: { $exists: false } }, { $set: { number } });
    numbered += modifiedCount;
  }
  return numbered;
}

export function migrateTicketNumbers(db) {
  return runMigrationOnce(db, MARKER_ID, async () => {
    const numbered = await numberExistingTickets(db);
    if (numbered) console.log(`[tickets] numbered ${numbered} existing ticket(s)`);
  });
}
