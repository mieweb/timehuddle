/**
 * GitHub issue/PR URL parsing and fetching utilities.
 *
 * Provides shared logic for detecting GitHub URLs, fetching issue metadata,
 * and creating tickets from GitHub issues.
 */
import { ticketApi } from '../../lib/api';

/** Regex to match GitHub issue or PR URLs. */
export const GITHUB_ISSUE_URL_RE = /github\.com\/([^/?#]+)\/([^/?#]+)\/(issues|pull)\/(\d+)/;

export interface GitHubUrlParts {
  owner: string;
  repo: string;
  type: 'issues' | 'pull';
  number: string;
}

export interface GitHubIssue {
  title: string;
  body: string | null;
}

/**
 * Parse a GitHub issue or PR URL into its component parts.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parseGithubIssueUrl(url: string): GitHubUrlParts | null {
  const match = url.match(GITHUB_ISSUE_URL_RE);
  if (!match) return null;
  const [, owner, repo, type, number] = match;
  return { owner, repo, type: type as 'issues' | 'pull', number };
}

/**
 * Check if a string is a valid GitHub issue/PR URL.
 */
export function isGithubIssueUrl(url: string): boolean {
  return GITHUB_ISSUE_URL_RE.test(url);
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
