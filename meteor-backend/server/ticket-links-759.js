/**
 * Moving links that aren't issues off tickets (#734 step 5).
 *
 * A ticket's link is now an issue from one of the org's sources: a GitHub issue
 * or pull request (`isLinkableUrl`), or a Redmine issue linked as one. Before,
 * any https address could be saved there: a doc, a drive folder, a repository
 * page. Those are moved into the ticket's description as `Link: <url>`, so
 * nothing someone saved is lost; it just stops being the ticket's link.
 *
 * A saved link that already names an issue stays, so it keeps its ID and is
 * still found by it: a GitHub issue or pull request, even one saved over http
 * before the https rule, or an issue on one of the org's servers (`RM0-233`).
 *
 * Takes `db` and has no Meteor imports, so it is testable on its own
 * (tests/ticket-servers.test.ts).
 */
import { github, matchIssueUrl, outsideIdOf } from '@timehuddle/ticket-sources';
import { ObjectId } from 'mongodb';

import { runMigrationOnce } from './migration-claim';

const MARKER_ID = 'ticket-links-issue-only-759';

/** Whether a saved `link` names an issue, on GitHub or on one of `servers`. */
function namesAnIssue(link, servers) {
  return matchIssueUrl(github, link) !== null || outsideIdOf(link, servers) !== null;
}

/**
 * The update that moves `ticket`'s link into its description, or null when its
 * link may stay. `servers` are the ticket's org's (`sourcePrefixes`). The
 * description is Markdown, so the address stays clickable.
 */
export function unlinkableLinkUpdate(ticket, servers = []) {
  const link = typeof ticket.github === 'string' ? ticket.github.trim() : '';
  if (!link || namesAnIssue(link, servers)) return null;
  const description = typeof ticket.description === 'string' ? ticket.description.trimEnd() : '';
  return {
    $set: {
      description: description ? `${description}\n\nLink: ${link}` : `Link: ${link}`,
      github: '',
    },
  };
}

/**
 * Move every ticket's non-issue link into its description. Each ticket is
 * written only if its link and description are still the ones read, so an edit
 * meanwhile is never overwritten. Returns how many moved.
 */
export async function moveUnlinkableLinks(db) {
  const serversByTeam = new Map();
  const serversOf = async (teamId) => {
    if (!serversByTeam.has(teamId)) {
      const team = await db
        .collection('teams')
        .findOne({ _id: toDocId(teamId) }, { projection: { orgId: 1 } });
      const org = team?.orgId
        ? await db
            .collection('organizations')
            .findOne({ _id: toDocId(team.orgId) }, { projection: { sourcePrefixes: 1 } })
        : null;
      serversByTeam.set(teamId, org?.sourcePrefixes ?? []);
    }
    return serversByTeam.get(teamId);
  };
  const tickets = db
    .collection('tickets')
    .find(
      { github: { $nin: ['', null] } },
      { projection: { github: 1, description: 1, teamId: 1 } },
    );
  let moved = 0;
  for await (const ticket of tickets) {
    const update = unlinkableLinkUpdate(ticket, await serversOf(ticket.teamId));
    if (!update) continue;
    const { modifiedCount } = await db
      .collection('tickets')
      .updateOne(
        { _id: ticket._id, github: ticket.github, description: ticket.description ?? null },
        update,
      );
    moved += modifiedCount;
  }
  return moved;
}

// Legacy teams and orgs can carry non-ObjectId string ids.
function toDocId(id) {
  return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}

export function migrateUnlinkableLinks(db) {
  return runMigrationOnce(db, MARKER_ID, async () => {
    const moved = await moveUnlinkableLinks(db);
    if (moved) console.log(`[tickets] moved ${moved} non-issue link(s) into descriptions`);
  });
}
