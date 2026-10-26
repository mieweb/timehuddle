/**
 * TimeHuddle's own tickets, described like any other source so the ticket page
 * can treat every source the same way (#734 step 3). Nothing is fetched from
 * outside: the fields are the ticket document's own.
 */
import { defineSource } from '../core.js';

export const timehuddle = defineSource({
  kind: 'timehuddle',
  label: 'TimeHuddle',
  connect: { auth: 'none' },
  // `THX-18`: the org's ticket prefix and the ticket's number (#689).
  id: { show: '{prefix}-{key}' },
  fields: {
    title: { path: 'title', edit: true },
    body: { path: 'description', format: 'markdown', edit: true },
    status: { path: 'status', edit: true, closedWhen: { equals: 'closed' } },
    priority: { path: 'priority', edit: true },
    assignees: { path: 'assignedTo', edit: true },
    reporter: { path: 'createdBy' },
    container: { path: 'teamId' },
    dates: { created: 'createdAt', updated: 'updatedAt' },
  },
});
