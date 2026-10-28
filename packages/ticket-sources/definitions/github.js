/**
 * GitHub issues and pull requests. Read-only for now; GitHub's API, signing
 * in with a token and write-back come in #734 step 4.
 */
import { defineSource } from '../core.js';

export const github = defineSource({
  kind: 'github',
  label: 'GitHub',
  connect: {
    auth: 'bearer',
    fields: [{ id: 'token', label: 'Personal access token', secret: true }],
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
    title: { path: 'title' },
    body: { path: 'body', format: 'markdown' },
    status: { path: 'state', closedWhen: { equals: 'closed' } },
    assignees: { path: 'assignees', name: 'login' },
    reporter: { path: 'user', name: 'login' },
    labels: { path: 'labels', name: 'name', color: 'color' },
    milestone: { path: 'milestone', name: 'title' },
    dates: { created: 'created_at', updated: 'updated_at', closed: 'closed_at' },
    conversation: { path: '@comments', author: 'user.login', text: 'body' },
  },
  can: { search: true },
});
