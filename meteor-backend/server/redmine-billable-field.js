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
import { createUserTtlCache } from './redmine-cache';
import { hostOf } from './ticket-ids';

const DEFINITIONS = 'redmine_field_definitions';

/**
 * Read again at most every ten minutes per user: a field's choices change
 * rarely, while a preview runs on every timer stop.
 */
const cache = createUserTtlCache(10 * 60 * 1000);

/** The Billable definition for the account's server, or null when none is known. */
export function billableDefinition(userId, account) {
  const host = hostOf(account.baseUrl);
  return cache.get(userId, `billable-definition:${host}`, async () => {
    const definitions = rawDb().collection(DEFINITIONS);
    // An outage reads as "may not read them": the kept definition still serves.
    const fields = await listCustomFields(account).catch(() => null);
    if (fields) {
      const billable = billableDefinitionOf(fields);
      await definitions.updateOne(
        { _id: host },
        { $set: { billable, readAt: new Date() } },
        { upsert: true },
      );
      return billable;
    }
    return (await definitions.findOne({ _id: host }))?.billable ?? null;
  });
}
