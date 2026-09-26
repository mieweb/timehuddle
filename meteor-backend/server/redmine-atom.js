/**
 * Redmine activity-feed extraction — issue ids and timestamps, nothing else (MVP2 A1).
 *
 * The relevant-issues list uses "what have I touched lately" as one of its
 * signals, and Redmine only exposes that through `/activity.atom`. That feed is
 * the single Redmine response in the whole integration that carries free text:
 * every entry has a `title`, a `summary` and a `content` holding the issue
 * subject and the note that was written. On the enterprise instance any of those
 * may contain PHI.
 *
 * So the feed is never handed on. This module reduces each entry to
 * `{ issueId, at }` — an integer and a date — and the rest of the entry is
 * discarded here, before it can reach a score, a cache, a log line or a
 * response. Ids alone are not enough to score with: the signal decays with age
 * (see redmine-relevance.js), which needs the entry's own `<updated>`. A
 * timestamp is not entry text.
 *
 * **Why regex and not an XML parser.** The alternative is a new dependency for
 * one feed. Extraction is bounded instead: ids are read only out of `<link>`
 * hrefs, and nothing but digits and a parsed date ever leaves the function, so a
 * mis-parse can drop or duplicate an id but cannot leak a word of the entry.
 * Escaped markup inside `content` (`&lt;a href=&quot;…`) cannot be mistaken for
 * a link element, because its quotes and angle brackets arrive escaped.
 *
 * Kept free of Meteor imports so it can be unit-tested directly
 * (see tests/redmine-atom.test.ts).
 */

/** One `<entry>…</entry>` block. Non-greedy, so entries do not run together. */
const ENTRY_PATTERN = /<entry\b[\s\S]*?<\/entry>/g;

/**
 * The issue id in an entry's `<link href="…">`, in either shape Redmine writes.
 *
 * Issue edits and notes link to the issue itself (`…/issues/1234#note-5`), but a
 * **time-entry** event links to the project's time-entry list with the issue as a
 * query parameter (`…/projects/x/time_entries?issue_id=1234`). Both are activity
 * on issue 1234, so both must be read.
 *
 * Matching only the path form made the whole signal near-inert on real data, and
 * did so silently: the feed is fetched and parsed without error, so `partial`
 * stays false and a short list looks like a quiet week. Measured against a live
 * feed, 11 of 13 entries were time-entry events and were all discarded — and time
 * logging is the activity this app exists to record.
 */
const ISSUE_LINK_PATTERN = /<link\b[^>]*\bhref="[^"]*?(?:\/issues\/(\d+)|[?&]issue_id=(\d+))/i;

/** When the entry happened. Atom requires `<updated>` on every entry. */
const UPDATED_PATTERN = /<updated>\s*([^<]+?)\s*<\/updated>/i;

/**
 * The issues an activity feed mentions, as `{ issueId, at }` per entry.
 *
 * `at` is the entry's `<updated>` as an ISO string, or null when it is missing
 * or unparseable — a caller that cannot date an entry treats it as fully
 * decayed rather than as fresh. Entries that are not about an issue (wiki edits,
 * forum posts, project changes) link to neither an issue path nor an `issue_id`,
 * and are dropped.
 * Non-string input yields an empty list.
 *
 * @param {unknown} xml  the body of `GET /activity.atom`
 * @returns {{issueId: number, at: string|null}[]}
 */
export function activityIssueRefs(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];

  const refs = [];
  for (const entry of xml.match(ENTRY_PATTERN) ?? []) {
    const link = entry.match(ISSUE_LINK_PATTERN);
    const id = link?.[1] ?? link?.[2];
    if (!id) continue;
    const issueId = Number(id);
    if (!Number.isSafeInteger(issueId) || issueId <= 0) continue;
    refs.push({ issueId, at: toIsoOrNull(entry.match(UPDATED_PATTERN)?.[1]) });
  }
  return refs;
}

/** An Atom timestamp as an ISO string, or null when it is absent or invalid. */
function toIsoOrNull(raw) {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
