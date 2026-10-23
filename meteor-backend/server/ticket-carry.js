/**
 * Carrying a Redmine issue on a TimeHuddle ticket (#736).
 *
 * `tickets.carryIssue` finds the ticket in a team that carries a Redmine issue,
 * or creates one titled from the issue and links it. The first action on a
 * bare issue (a timer, My Board) goes through here, so that what gets timed or
 * boarded is a TimeHuddle ticket. The rules live in `ticket-carry-core.js`.
 */
import { Meteor } from 'meteor/meteor';

import { requireIdentity } from './auth-bridge';
import { Tickets, rawDb } from './collections';
import { requireTeamMembership } from './permissions';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { optionalRedmineBaseUrl } from './redmine-client';
import { carriedTitle, carryLockId, findOrCarry, withCarryLock } from './ticket-carry-core';
import { redmineLinkFor } from './ticket-link-core';
import { announceLinkChange, readLinkableIssue } from './ticket-links';
import { hostOf } from './ticket-ids';
import { REDMINE, isRedmineIssueId } from './ticket-refs';
import { insertTicket, toPublicTicket } from './tickets';

const carryLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

/**
 * The oldest live ticket in `teamId` linked to Redmine issue `issueId`, or null.
 * Several can exist from before carrying (#736b cleans them up); the oldest is
 * the one an action lands on. Links name the deployment's own Redmine, with or
 * without a stored host, so the host is not compared.
 */
function findCarrier(teamId, issueId) {
  return Tickets.findOneAsync(
    {
      teamId,
      'linkedIssue.source': REDMINE,
      'linkedIssue.id': issueId,
      status: { $ne: 'deleted' },
    },
    { sort: { createdAt: 1 } },
  );
}

Meteor.methods({
  /**
   * The ticket in `teamId` carrying Redmine issue `issueId`, created and linked
   * if there is none. Any team member may ask. Creating one needs the caller's
   * Redmine account on the deployment's own server, and reads the issue with
   * their key; the new ticket is theirs and assigned to them.
   * Returns `{ ticket, created }`.
   */
  async 'tickets.carryIssue'({ teamId, issueId } = {}) {
    const { userId } = await requireIdentity(this);
    const team = await requireTeamMembership(userId, teamId);
    if (!isRedmineIssueId(issueId)) {
      throw new Meteor.Error('validation-error', 'issueId must be a Redmine issue number');
    }
    const id = String(issueId);

    let result;
    try {
      result = await withCarryLock(rawDb().collection('carry_locks'), carryLockId(teamId, id), () =>
        findOrCarry({
          findCarrier: async () => {
            const doc = await findCarrier(teamId, id);
            return doc ? toPublicTicket(doc) : null;
          },
          // Only creating a ticket asks Redmine, so only that counts against the limit.
          readIssue: () => {
            enforceRedmineLimit(carryLimiter, userId);
            return readLinkableIssue(userId, id);
          },
          // Inserted already linked, in one write: a failure after it leaves a
          // ticket the next carry finds, never an unlinked one beside it.
          createCarrier: async (issue) => {
            const doc = await insertTicket(
              userId,
              { teamId, orgId: team.orgId },
              {
                title: carriedTitle(issue, id),
                assignedTo: [userId],
                linkedIssue: redmineLinkFor(id, hostOf(optionalRedmineBaseUrl())),
              },
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
