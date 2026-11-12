/**
 * Carrying a Redmine issue on a TimeHuddle ticket (#736).
 *
 * `tickets.carryIssue` finds the ticket in a team that carries a Redmine issue,
 * or creates one titled from the issue and links it. The first action on a
 * bare issue (a timer, My Board) goes through here, so that what gets timed or
 * boarded is a TimeHuddle ticket. The rules live in `ticket-carry-core.js`.
 */
import { github, matchIssueUrl } from '@timehuddle/ticket-sources';
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { Tickets, rawDb } from './collections';
import { GITHUB_HOST } from './github-client';
import { driverFor } from './sources/registry';
import { requireTeamMembership } from './permissions';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { findRedmineAccount } from './redmine-account';
import { optionalRedmineBaseUrl } from './redmine-client';
import { carriedTitle, carryLockId, findOrCarry, withCarryLock } from './ticket-carry-core';
import { redmineLinkFor } from './ticket-link-core';
import { announceLinkChange, assertOnDefaultRedmine, readLinkableIssue } from './ticket-links';
import { hostOf } from './ticket-ids';
import { REDMINE, isRedmineIssueId } from './ticket-refs';
import { insertTicket, toPublicTicket } from './tickets';

// Each "Add more" on the board notice can carry 10 new issues, so this leaves
// room for several presses a minute.
const carryLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000 });

/**
 * The oldest live ticket in `teamId` linked to Redmine issue `issueId` on `host`,
 * or null. Several can exist from before carrying (#736b cleans them up); the
 * oldest is the one an action lands on. No `host` is the deployment's own
 * Redmine, whose links may or may not store theirs (`mainHost`).
 */
function findCarrier(teamId, issueId, host, mainHost) {
  return Tickets.findOneAsync(
    {
      teamId,
      'linkedIssue.source': REDMINE,
      'linkedIssue.id': issueId,
      'linkedIssue.host': host ?? { $in: [null, ...(mainHost ? [mainHost] : [])] },
      status: { $ne: 'deleted' },
    },
    { sort: { createdAt: 1 } },
  );
}

/** The team's live ticket displayed as the issue at any of `addresses`, or null. */
function findCarrierByAddress(teamId, addresses) {
  return Tickets.findOneAsync(
    {
      teamId,
      github: { $in: addresses },
      linkIsIssue: { $ne: false },
      status: { $ne: 'deleted' },
    },
    { sort: { createdAt: 1 } },
  );
}

/** Both addresses GitHub gives one number: an issue's and a pull request's. */
function issueAddresses(ref) {
  const base = `https://${GITHUB_HOST}/${ref.container}`;
  return [`${base}/issues/${ref.key}`, `${base}/pull/${ref.key}`];
}

Meteor.methods({
  /**
   * The ticket in `teamId` displayed as the GitHub issue or pull request at
   * `url`, created if there is none: titled from it, read with the caller's
   * connection, theirs and assigned to them. Only the address is stored, the
   * same as a ticket someone displayed as that issue by hand (#734).
   * Returns `{ ticket, created }`.
   */
  async 'tickets.carryLink'({ teamId, url } = {}) {
    const { userId } = await requireIdentity(this);
    const team = await requireTeamMembership(userId, teamId);
    const ref = typeof url === 'string' ? matchIssueUrl(github, url) : null;
    if (!ref?.container) {
      throw new Meteor.Error('validation-error', 'url must name a GitHub issue or pull request');
    }
    const addresses = issueAddresses(ref);
    let result;
    try {
      result = await withCarryLock(
        rawDb().collection('carry_locks'),
        carryLockId(teamId, `${GITHUB_HOST}:${ref.container}:${ref.key}`),
        () =>
          findOrCarry({
            findCarrier: async () => {
              const doc = await findCarrierByAddress(teamId, addresses);
              return doc ? toPublicTicket(doc) : null;
            },
            readIssue: async () => {
              enforceRedmineLimit(carryLimiter, userId);
              const driver = driverFor(github.kind);
              const session = await driver.open(userId);
              let issue;
              try {
                issue = await session.request(`/repos/${ref.container}/issues/${ref.key}`);
              } catch (err) {
                throw driver.toError(err);
              }
              if (!issue) {
                throw new Meteor.Error(
                  'issue-unavailable',
                  "That GitHub issue doesn't exist, or you don't have access to it.",
                );
              }
              return { subject: issue.title, html_url: issue.html_url };
            },
            createCarrier: async (issue) => {
              const doc = await insertTicket(
                userId,
                { teamId, orgId: team.orgId },
                {
                  title: carriedTitle(issue, ref.key),
                  assignedTo: [userId],
                  github: issue.html_url ?? addresses[0],
                  linkIsIssue: true,
                },
                { addToBoard: false },
              );
              return toPublicTicket(doc);
            },
          }),
      );
    } catch (err) {
      if (err?.code === 'carry-busy') throw new Meteor.Error('carry-busy', err.message);
      throw err;
    }
    return result;
  },

  /**
   * The ticket in `teamId` carrying Redmine issue `issueId`, created and linked
   * if there is none. Any team member may ask. Creating one needs the caller's
   * Redmine account on the deployment's own server, and reads the issue with
   * their key; the new ticket is theirs and assigned to them.
   * `host` names the issue's server when it isn't the main one (#734), read
   * with the caller's key there. Returns `{ ticket, created }`.
   */
  async 'tickets.carryIssue'({ teamId, issueId, host: rawHost } = {}) {
    const { userId } = await requireIdentity(this);
    const team = await requireTeamMembership(userId, teamId);
    if (!isRedmineIssueId(issueId)) {
      throw new Meteor.Error('validation-error', 'issueId must be a Redmine issue number');
    }
    const id = String(issueId);
    // Checked before the lookup: an issue number from another Redmine server
    // would otherwise land on this server's unrelated ticket with the same
    // number. A caller with no account can still reach an existing carrier.
    const mainHost = hostOf(optionalRedmineBaseUrl());
    const host = rawHost && rawHost !== mainHost ? rawHost : null;
    if (host !== null && hostOf(host) !== host) {
      throw new Meteor.Error('bad-request', 'Not a server.');
    }
    const account = await findRedmineAccount(userId, host ?? undefined);
    if (account && !host) assertOnDefaultRedmine(account);

    let result;
    try {
      result = await withCarryLock(rawDb().collection('carry_locks'), carryLockId(teamId, host ? `${host}:${id}` : id), () =>
        findOrCarry({
          findCarrier: async () => {
            const doc = await findCarrier(teamId, id, host, mainHost);
            return doc ? toPublicTicket(doc) : null;
          },
          // Only creating a ticket asks Redmine, so only that counts against the limit.
          readIssue: () => {
            enforceRedmineLimit(carryLimiter, userId);
            return readLinkableIssue(userId, id, host);
          },
          // Inserted already linked, in one write: a failure after it leaves a
          // ticket the next carry finds, never an unlinked one beside it. Not
          // put on My Board here: the action that carried it does that through
          // the capacity-checked `myBoard.addMany`, so a refused add leaves
          // nothing behind that the user wasn't told about.
          createCarrier: async (issue) => {
            const doc = await insertTicket(
              userId,
              { teamId, orgId: team.orgId },
              {
                title: carriedTitle(issue, id),
                assignedTo: [userId],
                linkedIssue: redmineLinkFor(id, host ?? mainHost),
              },
              { addToBoard: false },
            );
            await announceLinkChange(userId, doc, null, id);
            return toPublicTicket(doc);
          },
        }),
      );
    } catch (err) {
      if (err?.code === 'carry-busy') throw new Meteor.Error('carry-busy', err.message);
      throw err;
    }
    return result;
  },
});
