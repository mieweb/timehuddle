/**
 * GitHub issues and pull requests. A member connects in one click, with their
 * own OAuth token (Connect GitHub in Settings → Sources), so nothing is
 * registered per org. Only GitHub's own server, so no address to configure.
 */
import { defineSource, hook } from '../core.js';

export const github = defineSource({
  kind: 'github',
  label: 'GitHub',
  connect: {
    auth: 'bearer',
    oauth: true,
  },
  id: {
    hosts: ['github.com', 'www.github.com'],
    // `/mieweb/timehuddle/issues/223`, or `/pull/554`, with anything after it.
    match: /^\/(?<container>[^/?#]+\/[^/?#]+)\/(?:issues|pull)\/(?<key>\d+)/,
    show: '{repo}-{key}',
  },
  api: {
    base: 'https://api.github.com',
    issue: '/repos/{container}/issues/{key}',
    paging: 'link-header',
  },
  fields: {
    title: { path: 'title', edit: true },
    body: { path: 'body', format: 'markdown', edit: true },
    // GitHub's state as a named status, with its two moves (`withStatus`).
    status: {
      path: 'status',
      name: 'name',
      allowed: 'allowed_statuses',
      edit: 'allowed',
      closedWhen: { equals: 'closed' },
    },
    type: { path: 'kind', name: 'name' },
    assignees: { path: 'assignees', name: 'login' },
    reporter: { path: 'user', name: 'login' },
    labels: { path: 'labels', name: 'name', color: 'color' },
    milestone: { path: 'milestone', name: 'title' },
    dates: { created: 'created_at', updated: 'updated_at', closed: 'closed_at' },
    conversation: { from: hook('githubConversation') },
  },
  can: {
    search: hook('githubSearch'),
    assigned: hook('githubAssigned'),
    write: hook('githubWrite'),
  },
});
