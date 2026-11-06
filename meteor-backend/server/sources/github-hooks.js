/**
 * What GitHub's definition can't say as config (#734 step 4): searching, an
 * issue's comments, and writing back. The slim search shape carries no body.
 * No Meteor imports, so this is unit-testable (tests/github-hooks.test.ts).
 */
import { github, matchIssueUrl } from '@timehuddle/ticket-sources';

import { createUserTtlCache } from '../redmine-cache';

import { EngineError } from './engine';

const MAX_RESULTS = 25;
const MAX_SCOPES = 12;
/** How far back "assigned to me" looks: an issue no one has touched since is not current work. */
export const RECENT_DAYS = 8;
/** How many accounts and organizations a member may pick to bring issues from. */
export const MAX_OWNERS = 50;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_REPO_PAGES = 5;
const reposCache = createUserTtlCache(5 * 60 * 1000);
const REPO_ID = /^([\w.-]+)-(\d+)$/;
const BARE_NUMBER = /^#?\d+$/;

/** How the engine's status field reads an issue: state as a named, movable status. */
export function withStatus(answer) {
  if (!answer || typeof answer !== 'object' || !answer.state) return answer;
  const named = (state) => ({ id: state, name: state });
  return {
    ...answer,
    status: named(answer.state),
    allowed_statuses: [named('open'), named('closed')],
    kind: answer.pull_request
      ? { id: 'pull', name: 'Pull request' }
      : { id: 'issue', name: 'Issue' },
  };
}

/** Who owns the issue's repo: `/issues` sends `repository`, search only its URL. */
const repoOwnerOf = (item) =>
  item.repository?.owner?.login ?? item.repository_url?.split('/').slice(-2)[0];

const repoOf = (item) =>
  item.repository?.name ?? item.repository_url?.split('/').pop() ?? item.html_url?.split('/')[4];

/** One search result, slim: no body, no comments. */
export function toSlimIssue(item) {
  return {
    id: item.number,
    ref: `${repoOf(item)}-${item.number}`,
    url: item.html_url,
    subject: item.title ?? '',
    project: { id: repoOf(item), name: repoOf(item) },
    pull: Boolean(item.pull_request),
    status: null,
    assignedTo: null,
    priority: null,
    tracker: null,
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
  };
}

/**
 * Where a word search may look: the member, then the owners of the repos they
 * can reach, most recently active first. Search alone would cover all of public
 * GitHub. `user:` also matches an org. With `picked` (the accounts the member
 * chose in Settings → Sources), only those.
 */
export function searchScopes(login, repos, picked = null) {
  const owners = ownersOf(login, repos).filter((owner) => isPicked(picked, owner));
  return owners.slice(0, MAX_SCOPES).map((owner) => `user:${owner}`);
}

/** The member's own account, then each owner of a repo they can reach, once each. */
export function ownersOf(login, repos) {
  return [...new Set([login, ...repos.map((repo) => repo.owner?.login)].filter(Boolean))];
}

/** Whether `owner` is among the accounts picked; with none picked, every one is. */
export function isPicked(picked, owner) {
  if (!picked?.length) return true;
  const name = String(owner ?? '').toLowerCase();
  return picked.some((each) => each.toLowerCase() === name);
}

/** Picked accounts as stored: GitHub logins only, each once, or null for all. */
export function cleanOwners(owners) {
  if (owners == null) return null;
  if (!Array.isArray(owners) || owners.length > MAX_OWNERS || !owners.every((o) => OWNER.test(o))) {
    throw new EngineError('bad-request', 'Pick GitHub accounts or organizations by their login.');
  }
  const unique = [...new Set(owners)];
  return unique.length ? unique : null;
}

/** What `query` asks for: `{ url }`, `{ repo, number }`, `{ words }`, or null to ask nothing. */
export function readQuery(query) {
  const text = query.trim();
  if (/^https?:\/\//i.test(text)) {
    const ref = matchIssueUrl(github, text);
    return ref ? { container: ref.container, number: ref.key } : null;
  }
  const id = text.match(REPO_ID);
  if (id) return { repo: id[1], number: id[2] };
  // A bare number means nothing without a repo, and @name isn't a title.
  if (BARE_NUMBER.test(text) || text.startsWith('@') || text.length < 3) return null;
  return { words: text };
}

/**
 * The repos the member can reach, including ones they only collaborate on, in
 * orgs they aren't a member of: `/user/orgs` would miss those. Cached briefly, as
 * every search asks.
 */
function reachableRepos(request, userId) {
  return reposCache.get(userId, 'github-repos', async () => {
    const repos = [];
    for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
      const params = new URLSearchParams({
        affiliation: 'owner,collaborator,organization_member',
        sort: 'pushed',
        per_page: '100',
        page: String(page),
      });
      const batch = (await request(`/user/repos?${params}`)) ?? [];
      repos.push(...batch);
      if (batch.length < 100) break;
    }
    return repos;
  });
}

async function scopesFor(request, userId, owners) {
  const [me, repos] = await Promise.all([request('/user'), reachableRepos(request, userId)]);
  return searchScopes(me.login, repos, owners);
}

/**
 * The accounts a member can bring issues from, for Settings → Sources: their
 * own, then each organization or person whose repos they can reach.
 */
export async function githubOwners({ request, userId }) {
  const [me, repos] = await Promise.all([request('/user'), reachableRepos(request, userId)]);
  return ownersOf(me.login, repos).map((login) => ({ login, own: login === me.login }));
}

async function oneIssue(request, container, number) {
  const item = await request(`/repos/${container}/issues/${number}`);
  return item ? [toSlimIssue(item)] : [];
}

/**
 * `repo-number` on every reachable repo of that name. When several share the
 * name, each result is labelled with its owner (`acme/pulse-223`) to tell them apart.
 */
async function byRepoName(request, userId, repo, number, owners) {
  const repos = await reachableRepos(request, userId);
  const named = repos.filter(
    (item) => item.name.toLowerCase() === repo.toLowerCase() && isPicked(owners, item.owner?.login),
  );
  const lists = await Promise.all(
    named.map(async (item) => {
      const issues = await oneIssue(request, item.full_name, number).catch(() => []);
      return named.length > 1
        ? issues.map((issue) => ({ ...issue, ref: `${item.full_name}-${number}` }))
        : issues;
    }),
  );
  return lists.flat();
}

async function byWords(request, userId, words, owners) {
  const scopes = (await scopesFor(request, userId, owners)).join(' ');
  // GitHub asks for issues and pull requests separately.
  const pages = await Promise.all(
    ['is:issue', 'is:pull-request'].map((kind) => {
      const params = new URLSearchParams({
        q: `${words} in:title ${kind} ${scopes}`,
        sort: 'updated',
        per_page: String(MAX_RESULTS),
      });
      return request(`/search/issues?${params}`);
    }),
  );
  return pages
    .flatMap((page) => page?.items ?? [])
    .sort((a, b) => Date.parse(b.updated_at ?? 0) - Date.parse(a.updated_at ?? 0))
    .slice(0, MAX_RESULTS)
    .map(toSlimIssue);
}

export const githubHooks = {
  /** What the search bar's text finds, on repos the member can reach. */
  async githubSearch(query, { request, userId, owners }) {
    const asked = readQuery(query);
    if (!asked) return [];
    // A pasted link is asked for as it is, whoever owns it.
    if (asked.container) return oneIssue(request, asked.container, asked.number);
    if (asked.repo) return byRepoName(request, userId, asked.repo, asked.number, owners);
    return byWords(request, userId, asked.words, owners);
  },

  /**
   * Open issues and pull requests assigned to the member and touched in the
   * last `RECENT_DAYS`, newest first, for the search bar before they type and
   * for filling an empty My Board. Only from the accounts they picked, if any.
   */
  async githubAssigned({ request, owners }, { now = Date.now() } = {}) {
    const since = new Date(now - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      filter: 'assigned',
      state: 'open',
      sort: 'updated',
      since,
      // A page wide enough that the picked accounts still fill a list.
      per_page: '100',
    });
    const items = (await request(`/issues?${params}`)) ?? [];
    return items
      .filter((item) => isPicked(owners, repoOwnerOf(item)))
      .slice(0, MAX_RESULTS)
      .map(toSlimIssue);
  },

  /** An issue's comments, as the record's conversation. */
  async githubConversation(raw, { request }) {
    if (!raw.comments || !raw.comments_url) return [];
    const path = new URL(raw.comments_url).pathname;
    const comments = await request(`${path}?per_page=100`);
    return (comments ?? []).map((comment) => ({
      kind: 'comment',
      id: `comment:${comment.id}`,
      author: comment.user ? { id: String(comment.user.id), name: comment.user.login } : null,
      at: comment.created_at,
      text: { text: comment.body ?? '', format: 'markdown' },
    }));
  },

  /** Write the changed fields, then report any GitHub didn't store as sent. */
  async githubWrite({ raw, edits }, { request }) {
    const body = {};
    if (edits.title !== undefined) body.title = edits.title;
    if (edits.body !== undefined) body.body = edits.body;
    if (edits.status !== undefined) {
      const state = typeof edits.status === 'string' ? edits.status : edits.status?.id;
      if (state !== 'open' && state !== 'closed') {
        throw new EngineError('bad-request', 'Status must be open or closed.');
      }
      body.state = state;
    }
    if (Object.keys(body).length === 0) return { raw, mismatches: [] };
    const path = new URL(raw.url).pathname;
    const stored = withStatus(await request(path, { method: 'PATCH', body }));
    const mismatches = Object.keys(body).filter((key) => stored?.[key] !== body[key]);
    return { raw: stored, mismatches };
  },
};
