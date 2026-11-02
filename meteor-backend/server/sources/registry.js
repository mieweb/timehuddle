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
 */
import { github, redmine } from '@timehuddle/ticket-sources';
import { Meteor } from 'meteor/meteor';

import { GITHUB_HOST, githubRequest } from '../github-client';

import { toRedmineMeteorError } from '../redmine';
import { redmineUserIdFor, requireRedmineAccount } from '../redmine-account';
import { requestOrNull } from '../redmine-client';
import { hostOf } from '../ticket-ids';
import { assertOnDefaultRedmine } from '../ticket-links';

import { githubHooks, withStatus } from './github-hooks';
import { redmineHooks } from './redmine-hooks';

/** A GitHub refusal, read the way the methods read a Redmine one. */
function toGithubError(err) {
  if (err?.status === 401) return new Meteor.Error('invalid-key', 'GitHub rejected your connection.');
  if (err?.rateLimited) {
    return new Meteor.Error('rate-limited', "GitHub's rate limit was hit. Try again in a few minutes.");
  }
  if (err?.status === 403) {
    return new Meteor.Error('forbidden', 'GitHub refused: the org may need to approve TimeHuddle.');
  }
  return new Meteor.Error('unreachable', 'Could not reach GitHub.');
}

const DRIVERS = {
  github: {
    definition: github,
    hooks: githubHooks,
    toError: toGithubError,
    async open(userId) {
      const account = await requireRedmineAccount(userId, GITHUB_HOST);
      const request = async (path, options) => {
        try {
          return withStatus(await githubRequest(path, account, options));
        } catch (err) {
          if (!options?.method && err?.status === 404) return null;
          throw err;
        }
      };
      return {
        server: GITHUB_HOST,
        ctx: { userId, account, request },
        request,
        urlOf: (ref) => `https://${GITHUB_HOST}/${ref.container}/issues/${ref.key}`,
        me: () => request('/user').then((me) => (me?.id == null ? null : String(me.id)), () => null),
      };
    },
  },
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
