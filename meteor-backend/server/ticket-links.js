/**
 * Linking a TimeHuddle ticket to a Redmine issue (#636).
 *
 * The ticket keeps `linkedIssue: { source: 'redmine', id }` — the issue's number
 * and nothing else. Its subject, status and assignee are never stored: every
 * viewer reads them from Redmine with their own key (`redmine.issues.relevant`
 * returns them as `linkedIssues`).
 *
 * Anyone who may edit the ticket may change its link. Linking is checked
 * against Redmine under the caller's own key, so a ticket can only be linked to
 * an issue the person linking it can see.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge';
import { Teams, Tickets, Timers, WorkItems } from './collections';
import { requireTicketPermission } from './permissions';
import { createNotification, userDisplayName } from './notify-core';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit, toRedmineMeteorError } from './redmine';
import { requireRedmineAccount } from './redmine-account';
import { bustUserCaches } from './redmine-cache';
import { getIssue, onDefaultRedmine } from './redmine-client';
import { pushLedgerFor } from './redmine-time-sync';
import {
  linkAction,
  linkNotificationBody,
  linkedIssueIdOf,
  linkedTimeSummary,
  lockMessage,
  matchesExpectedLink,
} from './ticket-link-core';
import { assertUnlocked, findLockHolders, usersWithTimeOn } from './ticket-lock';
import { HUDDLE, REDMINE, isRedmineIssueId, sourceSelector } from './ticket-refs';
import { emitTicketActivity, toPublicTicket } from './tickets';
import { redmineTicketDaysFor } from './timer-core';

// Finds one person's time logged under a linked issue (`redmineTicketDaysFor`).
Meteor.startup(async () => {
  try {
    await Timers.createIndexAsync(
      { userId: 1, redmineIssueId: 1 },
      {
        name: 'linked_issue_sessions',
        partialFilterExpression: { redmineIssueId: { $type: 'string' } },
      },
    );
  } catch (error) {
    console.error('[ticket-links] failed to create the linked-session index:', error);
  }
});

/**
 * The caller's own time on a ticket, as the figures a link change puts at
 * stake. Other people's time is never read: a caller only ever learns how many
 * teammates have some.
 */
async function callerTimeOn(userId, ticket) {
  const items = await WorkItems.find(
    { userId, ticketId: ticket._id.toHexString(), ...sourceSelector(HUDDLE) },
    { fields: { _id: 1 } },
  ).fetchAsync();
  const sessions = items.length
    ? await Timers.find(
        { workItemId: { $in: items.map((item) => item._id.toHexString()) } },
        { fields: { redmineIssueId: 1, date: 1, endTime: 1, durationSeconds: 1 } },
      ).fetchAsync()
    : [];
  const issueId = linkedIssueIdOf(ticket);
  const [poolTotals, ledger] =
    issueId && sessions.length
      ? await Promise.all([redmineTicketDaysFor(userId), pushLedgerFor(userId)])
      : [[], new Map()];
  return linkedTimeSummary({ sessions, issueId, poolTotals, ledger });
}

/** Each link is one Redmine read; nobody links more than a few tickets a minute. */
const linkLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

const STALE_LINK = "This ticket's link was changed by someone else. Reload it and try again.";

/**
 * The relevant list is cached per user and carries the linked issues, so a link
 * change has to clear it for everyone who can see the ticket, not just the caller.
 */
async function bustTeamCaches(teamId) {
  const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId), {
    fields: { members: 1, admins: 1 },
  });
  for (const uid of new Set([...(team?.members ?? []), ...(team?.admins ?? [])])) {
    bustUserCaches(uid);
  }
}

/**
 * Tell teammates who logged time on the ticket that its link changed, since it
 * decides where their time goes from now on. The person who made the change
 * was told in the dialog.
 */
async function notifyLinkChange(actorId, ticket, change) {
  const ticketId = ticket._id.toHexString();
  const recipients = (await usersWithTimeOn(ticketId)).filter((uid) => uid !== actorId);
  if (!recipients.length) return;
  const actorName = await userDisplayName(actorId);
  const body = linkNotificationBody({ actorName, ticketTitle: ticket.title, ...change });
  await Promise.all(
    recipients.map((uid) =>
      createNotification({
        userId: uid,
        title: 'Huddle',
        body,
        // Flat strings only: FCM stringifies every value.
        data: {
          type: 'ticket-link-changed',
          ticketId,
          teamId: ticket.teamId,
          action: change.action,
          url: `/app/tickets/${ticketId}`,
        },
      }).catch((err) => console.error(`[ticket] notify link change ${uid} failed:`, err)),
    ),
  );
}

/**
 * Write the link (`nextId`) or remove it (`nextId` null), provided the stored
 * link is still the one the caller saw. Records the change in the ticket's
 * activity, with ids only.
 */
async function writeLink(userId, ticket, nextId) {
  const previousId = linkedIssueIdOf(ticket);
  const stamp = { updatedAt: new Date(), updatedBy: userId };
  const changed = await Tickets.updateAsync(
    {
      _id: ticket._id,
      ...(previousId ? { 'linkedIssue.id': previousId } : { linkedIssue: { $exists: false } }),
    },
    nextId
      ? { $set: { linkedIssue: { source: REDMINE, id: nextId }, ...stamp } }
      : { $unset: { linkedIssue: '' }, $set: stamp },
  );
  if (!changed) throw new Meteor.Error('stale-link', STALE_LINK);

  const updated = await Tickets.findOneAsync(ticket._id);
  const ticketId = ticket._id.toHexString();
  const change = {
    action: linkAction(previousId, nextId),
    ...(nextId ? { issueId: nextId } : {}),
    ...(previousId ? { previousIssueId: previousId } : {}),
  };
  await emitTicketActivity(userId, ticket.teamId, 'ticket.updated', {
    ticketId,
    ticketTitle: ticket.title,
    teamId: ticket.teamId,
    ...change,
  });
  await bustTeamCaches(ticket.teamId);
  await notifyLinkChange(userId, ticket, change);
  return toPublicTicket(updated);
}

Meteor.methods({
  /**
   * Link a ticket to a Redmine issue the caller can see, or move its link to a
   * different one. `expectedIssueId` is the link the caller last saw (null for
   * none); a mismatch is refused as `stale-link`.
   */
  async 'tickets.link'({ ticketId, issueId, expectedIssueId = null } = {}) {
    const { userId } = await requireIdentity(this);
    const ticket = await requireTicketPermission(userId, ticketId, 'update');
    if (!isRedmineIssueId(issueId)) {
      throw new Meteor.Error('validation-error', 'issueId must be a Redmine issue number');
    }
    const nextId = String(issueId);
    if (!matchesExpectedLink(ticket, expectedIssueId)) {
      throw new Meteor.Error('stale-link', STALE_LINK);
    }
    if (linkedIssueIdOf(ticket) === nextId) return toPublicTicket(ticket);
    // Refused even for a first link: a timer already running would be
    // recording time that belongs to no issue.
    await assertUnlocked(ticket, userId, { evenIfUnlinked: true });

    enforceRedmineLimit(linkLimiter, userId);
    const account = await requireRedmineAccount(userId);
    // A link is shared by the team and names an issue by number alone, so it
    // can only mean an issue on the deployment's own Redmine.
    if (!onDefaultRedmine(account)) {
      throw new Meteor.Error(
        'custom-instance',
        'Tickets can only be linked to issues on the Redmine server this TimeHuddle uses.',
      );
    }

    let issue;
    try {
      issue = await getIssue(account, Number(nextId));
    } catch (err) {
      throw toRedmineMeteorError(err);
    }
    if (!issue) {
      throw new Meteor.Error(
        'issue-unavailable',
        "That Redmine issue doesn't exist, or you don't have access to it.",
      );
    }

    return writeLink(userId, ticket, nextId);
  },

  /**
   * Remove a ticket's link. It carries on as a plain TimeHuddle ticket, and
   * nothing changes in Redmine. Needs no Redmine account.
   */
  async 'tickets.unlink'({ ticketId, expectedIssueId } = {}) {
    const { userId } = await requireIdentity(this);
    const ticket = await requireTicketPermission(userId, ticketId, 'update');
    if (!linkedIssueIdOf(ticket)) return toPublicTicket(ticket);
    if (!matchesExpectedLink(ticket, expectedIssueId)) {
      throw new Meteor.Error('stale-link', STALE_LINK);
    }
    await assertUnlocked(ticket, userId);
    return writeLink(userId, ticket, null);
  },

  /**
   * What a page needs to know before offering to change a ticket or its link:
   * who is timing it right now (`lock`, null when nobody is, or when the ticket
   * is not linked and so is not locked). `message` is the sentence a refused
   * change would carry, so the page and the refusal read the same.
   *
   * Also the caller's own time on the ticket (`myTime`, see `linkedTimeSummary`)
   * and how many teammates have logged time on it, for the warnings shown
   * before a link is changed.
   */
  async 'tickets.linkStatus'({ ticketId } = {}) {
    const { userId } = await requireIdentity(this);
    const ticket = await requireTicketPermission(userId, ticketId, 'read');
    const ticketHexId = ticket._id.toHexString();
    const [holders, myTime, timed] = await Promise.all([
      linkedIssueIdOf(ticket) ? findLockHolders(ticketHexId) : [],
      callerTimeOn(userId, ticket),
      usersWithTimeOn(ticketHexId),
    ]);
    return {
      lock: holders.length ? { holders, message: lockMessage(holders, userId) } : null,
      myTime,
      othersWithTime: timed.filter((uid) => uid !== userId).length,
    };
  },
});
