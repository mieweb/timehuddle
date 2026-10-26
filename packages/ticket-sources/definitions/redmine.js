/**
 * Redmine. Read with each member's own API key, so Redmine's own permissions
 * and workflow decide what they see and may change.
 */
import { defineSource, hook } from '../core.js';

export const redmine = defineSource({
  kind: 'redmine',
  label: 'Redmine',
  connect: {
    auth: 'header',
    header: 'X-Redmine-API-Key',
    fields: [{ id: 'apiKey', label: 'API key', secret: true }],
  },
  id: {
    // Any Redmine server, at its root or under a path (`/redmine/issues/214`):
    // which hosts are Redmine is the org's server list.
    match: /\/issues\/(?<key>\d+)\/?$/,
    show: '{prefix}-{key}',
  },
  api: { issue: '/issues/{key}.json', paging: 'offset' },
  fields: {
    title: { path: 'subject', edit: true },
    body: { path: 'description', format: 'textile', edit: true },
    // Redmine's status names are the instance's own; whether one is closed
    // comes from the instance's status list.
    status: { path: 'status.name', edit: 'allowed', closedWhen: hook('redmineIsClosed') },
    priority: { path: 'priority.name', edit: true },
    assignees: { path: 'assigned_to', name: 'name', max: 1, edit: true },
    reporter: { path: 'author', name: 'name' },
    // Redmine has no labels of its own: its tracker and category stand in.
    labels: { groups: { tracker: 'tracker.name', category: 'category.name' } },
    type: { path: 'tracker', name: 'name' },
    container: { path: 'project', name: 'name' },
    milestone: { path: 'fixed_version', name: 'name' },
    dates: { created: 'created_on', updated: 'updated_on', due: 'due_date' },
    // Journals hold comments and field changes in one list.
    conversation: { from: hook('redmineJournals') },
    extra: { path: 'custom_fields', name: 'name', value: 'value' },
  },
  can: { search: true, suggest: true, sendTime: hook('redmineSendTime') },
});
