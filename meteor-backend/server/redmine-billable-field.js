/**
 * Redmine's own definition of the Billable field, for the dropdown it is picked
 * from (#786): its id, whether it is required, and its choices.
 *
 * Redmine lists custom fields to administrators only (`/custom_fields.json`),
 * unlike activities, which any key may read. So whenever a member whose key is
 * an administrator's previews time, the definition read is kept for that
 * server, and every other member's dropdown is built from what was kept. Until
 * an administrator has connected, there is none, and the value copied from
 * recent entries is sent as before.
 *
 * Kept per server, not per organization: the field belongs to the Redmine.
 */
import { rawDb } from './collections';
import { listCustomFields } from './redmine-client';
import { billableDefinitionOf } from './redmine-billable';
import { hostOf } from './ticket-ids';

const DEFINITIONS = 'redmine_field_definitions';

/**
 * Whether each user's key may list custom fields, and what it read, for an
 * hour: a field's choices change rarely, and a key that may not read them is
 * refused (and the refusal logged) at most once an hour rather than on every
 * timer stop. A plain map, not `createUserTtlCache`: `bustUserCaches` runs on
 * every send and pin, and would ask again each time. An outage is not kept, so
 * the next preview asks again.
 */
const READ_TTL_MS = 60 * 60 * 1000;
const reads = new Map();

/** `{ readable, billable? }` for the user's key on this server, read at most once an hour. */
async function readWithKey(userId, account, host, definitions) {
  const key = `${userId}|${host}`;
  const kept = reads.get(key);
  if (kept && kept.expiresAt > Date.now()) return kept.read;
  const fields = await listCustomFields(account);
  const read = fields ? { readable: true, billable: billableDefinitionOf(fields) } : { readable: false };
  if (read.readable) {
    await definitions.updateOne(
      { _id: host },
      { $set: { billable: read.billable, readAt: new Date() } },
      { upsert: true },
    );
  }
  reads.set(key, { read, expiresAt: Date.now() + READ_TTL_MS });
  return read;
}

/** The Billable definition for the account's server, or null when none is known. */
export async function billableDefinition(userId, account) {
  const host = hostOf(account.baseUrl);
  const definitions = rawDb().collection(DEFINITIONS);
  const read = await readWithKey(userId, account, host, definitions).catch(() => ({
    readable: false,
  }));
  if (read.readable) return read.billable;
  // Read every time: what an administrator's key kept reaches everyone at once.
  return (await definitions.findOne({ _id: host }))?.billable ?? null;
}
