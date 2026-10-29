/**
 * Ticket IDs (#689). Every ticket gets a number from its organization's
 * counter, and is shown as `<org prefix>-<number>`, e.g. `TH-12`. An org can
 * also name the servers its outside issues live on, so Redmine issue 233 on
 * `redmine.example.com` shows as `PM-233`.
 *
 * Prefixes live on the organization and are read at display time, never
 * copied onto tickets, so renaming one relabels every ticket at once. Takes the
 * Mongo `db` and has no Meteor imports, so it is testable
 * (tests/ticket-ids.test.ts, tests/ticket-servers.test.ts).
 *
 * The servers an org names are its server registry (#734 step 5): each has a
 * type, saying which source definition reads its issues, and the address it
 * lives at.
 */
import { github } from '@timehuddle/ticket-sources';
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

/** How many servers an org can name. */
export const MAX_SOURCE_PREFIXES = 20;

/**
 * The source types an owner can register a server as. GitHub isn't one: it is
 * built in, the same for every org. Jira joins when it has a definition.
 */
export const SERVER_TYPES = Object.freeze(['redmine']);

/**
 * How a Redmine server's time entries are rounded: up to this many minutes.
 * A server with none set sends exact minutes.
 */
export const ROUNDING_STEPS = Object.freeze({ up3: 3, up5: 5, up10: 10, up15: 15 });

/** The bare lowercase hostname of a pasted URL or hostname, or null. */
export function hostOf(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const text = input.trim();
  try {
    const { hostname } = new URL(text.includes('://') ? text : `https://${text}`);
    return hostname.includes('.') || hostname === 'localhost' ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * A server's address in canonical form — `origin` plus any path Redmine lives
 * under, no trailing slash — from a pasted URL or bare hostname, or null.
 * https only, except a server on localhost (dev).
 */
export function serverBaseUrlOf(input) {
  const host = hostOf(input);
  if (!host) return null;
  const text = input.trim();
  const url = new URL(text.includes('://') ? text : `https://${text}`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && host === 'localhost')) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * The servers to store for `input`, a list of `{ host, prefix, type, baseUrl }`.
 * An entry's address is `baseUrl` or, as before types existed, `host`; its type
 * defaults to Redmine. Throws an Error whose message says what is wrong, for
 * the caller to show. `ticketPrefix` is the org's own, which no server may share.
 */
export function normalizeSourcePrefixes(input, ticketPrefix) {
  if (!Array.isArray(input)) throw new Error('sourcePrefixes must be a list');
  if (input.length > MAX_SOURCE_PREFIXES) {
    throw new Error(`An organization can name up to ${MAX_SOURCE_PREFIXES} servers`);
  }
  const hosts = new Set();
  const prefixes = new Set([ticketPrefix]);
  return input.map((entry) => {
    const address = entry?.baseUrl || entry?.host;
    const host = hostOf(address);
    const baseUrl = serverBaseUrlOf(address);
    if (!host || !baseUrl) throw new Error(`Not a server address: ${address ?? ''}`);
    if (github.id.hosts.includes(host)) {
      throw new Error('GitHub needs no setup: its issues show as the repository and number');
    }
    const type = entry?.type ?? 'redmine';
    if (!SERVER_TYPES.includes(type)) throw new Error(`${host}: not a server type: ${type}`);
    const prefix = normalizeTicketPrefix(entry?.prefix);
    if (!prefix) {
      throw new Error(`${host}: a prefix is a letter followed by up to five letters or digits`);
    }
    if (hosts.has(host)) throw new Error(`${host} is listed twice`);
    if (prefixes.has(prefix)) throw new Error(`${prefix} is already in use`);
    const rounding = entry?.rounding ?? 'exact';
    if (rounding !== 'exact' && !ROUNDING_STEPS[rounding]) {
      throw new Error(`${host}: not a rounding: ${rounding}`);
    }
    hosts.add(host);
    prefixes.add(prefix);
    // Exact is stored as nothing, so a server saved before rounding is unchanged.
    return { host, prefix, type, baseUrl, ...(rounding === 'exact' ? {} : { rounding }) };
  });
}

/**
 * An org's servers as the registry stores them, from entries saved before
 * types existed (`{ host, prefix }`). Every one was named for Redmine, so
 * it becomes a Redmine server, at `redmineBaseUrl` when that is its host (it
 * may live under a path), else at its host's root. A GitHub row never did
 * anything (GitHub is built in) and is dropped. Typed entries are kept as they
 * are.
 */
export function typedServers(entries, redmineBaseUrl) {
  const redmineHost = hostOf(redmineBaseUrl);
  return entries
    .filter((entry) => entry.type || !github.id.hosts.includes(entry.host))
    .map((entry) =>
      entry.type
        ? entry
        : {
            ...entry,
            type: 'redmine',
            baseUrl:
              entry.host === redmineHost ? redmineBaseUrl.replace(/\/+$/, '') : `https://${entry.host}`,
          },
    );
}

/**
 * Give every org's servers a type and address (#734 step 5), once. Each org is
 * written only if its list is still the one read, so an owner's save meanwhile
 * is never overwritten; they saved typed entries anyway.
 */
export function migrateServerTypes(db, { redmineBaseUrl }) {
  return runMigrationOnce(db, 'ticket-servers-759', async () => {
    const orgs = db
      .collection('organizations')
      .find({ 'sourcePrefixes.0': { $exists: true } }, { projection: { sourcePrefixes: 1 } });
    let typed = 0;
    for await (const org of orgs) {
      if (org.sourcePrefixes.every((entry) => entry.type)) continue;
      const { modifiedCount } = await db
        .collection('organizations')
        .updateOne(
          { _id: org._id, sourcePrefixes: org.sourcePrefixes },
          { $set: { sourcePrefixes: typedServers(org.sourcePrefixes, redmineBaseUrl) } },
        );
      typed += modifiedCount;
    }
    if (typed) console.log(`[orgs] gave ${typed} organization(s) server types`);
  });
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

/** What a team shows its tickets with when its org has set nothing. */
export const DEFAULT_TICKET_IDS = Object.freeze({
  ticketPrefix: DEFAULT_TICKET_PREFIX,
  sourcePrefixes: Object.freeze([]),
});

/**
 * Each org's ticket IDs, keyed by org id: its ticket prefix and the servers it
 * names. An org that has set neither, or a missing org, gets the defaults.
 */
export async function ticketIdsFor(db, orgIds) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const orgs = ids.length
    ? await db
        .collection('organizations')
        .find(
          { _id: { $in: ids.map((id) => toDocId(id)) } },
          { projection: { ticketPrefix: 1, sourcePrefixes: 1 } },
        )
        .toArray()
    : [];
  const byId = new Map(orgs.map((org) => [String(org._id), org]));
  return new Map(
    ids.map((id) => {
      const org = byId.get(id);
      return [
        id,
        {
          ticketPrefix: org?.ticketPrefix || DEFAULT_TICKET_PREFIX,
          sourcePrefixes: org?.sourcePrefixes ?? DEFAULT_TICKET_IDS.sourcePrefixes,
        },
      ];
    }),
  );
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
