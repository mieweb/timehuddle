/**
 * The sources the driver engine serves (#734 step 3), by kind: each one's
 * definition, its hooks, how its errors read, and `open(userId, host)`, the
 * member's way in with their own key for the server `host` (their main link
 * when omitted):
 *
 *   `{ server, ctx, request(path), urlOf(ref), me() }`
 *
 * `server` is the host the member's account is on; `request` resolves to the
 * source's answer, or null when the issue is missing or hidden from them.
 * Only Redmine for now: GitHub joins in step 4.
 */
import { redmine } from '@timehuddle/ticket-sources';

import { toRedmineMeteorError } from '../redmine';
import { redmineUserIdFor, requireRedmineAccount } from '../redmine-account';
import { requestOrNull } from '../redmine-client';
import { hostOf } from '../ticket-ids';
import { assertOnDefaultRedmine } from '../ticket-links';

import { redmineHooks } from './redmine-hooks';

const DRIVERS = {
  redmine: {
    definition: redmine,
    hooks: redmineHooks,
    toError: toRedmineMeteorError,
    async open(userId, host) {
      const account = await requireRedmineAccount(userId, host);
      // A link saved without its server means the deployment's Redmine: an
      // account on another server would read that server's issue of the same
      // number.
      if (!host) assertOnDefaultRedmine(account);
      return {
        server: hostOf(account.baseUrl),
        ctx: { userId, account },
        request: (path) => requestOrNull(path, account),
        urlOf: (ref) => `${account.baseUrl}/issues/${ref.key}`,
        // Best-effort: without it the page can't pick out the member's own activity.
        me: () =>
          redmineUserIdFor(userId, account).then(
            (id) => (id == null ? null : String(id)),
            () => null,
          ),
      };
    },
  },
};

/** The driver for outside issues of `kind`, or null when the engine doesn't serve it. */
export function driverFor(kind) {
  return Object.hasOwn(DRIVERS, kind) ? DRIVERS[kind] : null;
}
