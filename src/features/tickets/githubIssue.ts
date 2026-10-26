/**
 * GitHub issue/PR URL parsing and fetching utilities.
 *
 * Provides shared logic for detecting GitHub URLs, fetching issue metadata,
 * and creating tickets from GitHub issues.
 */
import { github, matchIssueUrl } from '@timehuddle/ticket-sources';

import { ticketApi } from '../../lib/api';

export interface GitHubUrlParts {
  owner: string;
  repo: string;
  number: string;
}

export interface GitHubIssue {
  title: string;
  body: string | null;
}

/**
 * Parse a GitHub issue or PR URL into its component parts, by the GitHub
 * definition in `@timehuddle/ticket-sources` (#734). A pasted address without
 * `https://` still counts. Returns null if the URL isn't a GitHub issue or PR.
 */
export function parseGithubIssueUrl(url: string): GitHubUrlParts | null {
  const text = url.trim();
  const ref = matchIssueUrl(github, /^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!ref?.container) return null;
  const [owner, repo] = ref.container.split('/');
  return { owner, repo, number: ref.key };
}

/**
 * Check if a string is a valid GitHub issue/PR URL.
 */
export function isGithubIssueUrl(url: string): boolean {
  return parseGithubIssueUrl(url) !== null;
}

/**
 * Fetch issue/PR metadata from the GitHub API.
 * Returns title and body, or null on error.
 */
export async function fetchGithubIssue(url: string): Promise<GitHubIssue | null> {
  const parts = parseGithubIssueUrl(url);
  if (!parts) return null;

  const { owner, repo, number } = parts;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; body?: string | null };
    return {
      title: data.title ?? '',
      body: data.body ?? null,
    };
  } catch {
    return null;
  }
}

export interface CreateTicketFromGithubParams {
  teamId: string;
  url: string;
  title: string;
  description: string | null;
}

/**
 * Create a ticket from a GitHub issue URL.
 * Creates the ticket with the title and URL, then updates with description if present.
 */
export async function createTicketFromGithub({
  teamId,
  url,
  title,
  description,
}: CreateTicketFromGithubParams): Promise<{ id: string }> {
  const ticket = await ticketApi.createTicket({
    teamId,
    title,
    github: url,
  });

  if (description && description.trim()) {
    await ticketApi.updateTicket(ticket.id, { description: description.trim() });
  }

  return { id: ticket.id };
}

/** Just the title of a GitHub issue or PR, or null when it can't be fetched. */
export async function fetchGithubIssueTitle(url: string): Promise<string | null> {
  const issue = await fetchGithubIssue(url);
  return issue?.title ?? null;
}
