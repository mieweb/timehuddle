/**
 * Moving links that aren't issues off tickets (#734 step 5).
 *
 * A ticket's link is now an issue from one of the org's sources: a GitHub issue
 * or pull request (`isLinkableUrl`), or a Redmine issue linked as one. Before,
 * any https address could be saved there: a doc, a drive folder, a repository
 * page. Those are moved into the ticket's description as `Link: <url>`, so
 * nothing someone saved is lost; it just stops being the ticket's link.
 *
 * Takes `db` and has no Meteor imports, so it is testable on its own
 * (tests/ticket-servers.test.ts).
 */
import { runMigrationOnce } from './migration-claim';
import { isLinkableUrl } from './ticket-link-core';

const MARKER_ID = 'ticket-links-issue-only-759';

/**
 * The update that moves `ticket`'s link into its description, or null when its
 * link may stay. The description is Markdown, so the address stays clickable.
 */
export function unlinkableLinkUpdate(ticket) {
  const link = typeof ticket.github === 'string' ? ticket.github.trim() : '';
  if (!link || isLinkableUrl(link)) return null;
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
  const tickets = db
    .collection('tickets')
    .find({ github: { $nin: ['', null] } }, { projection: { github: 1, description: 1 } });
  let moved = 0;
  for await (const ticket of tickets) {
    const update = unlinkableLinkUpdate(ticket);
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

export function migrateUnlinkableLinks(db) {
  return runMigrationOnce(db, MARKER_ID, async () => {
    const moved = await moveUnlinkableLinks(db);
    if (moved) console.log(`[tickets] moved ${moved} non-issue link(s) into descriptions`);
  });
}
