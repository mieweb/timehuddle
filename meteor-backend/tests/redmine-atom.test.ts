/**
 * Unit tests for the activity-feed extraction (server/redmine-atom.js).
 *
 * The rule these exist to pin is a privacy rule, not a parsing one: the activity
 * feed is the only Redmine response carrying issue subjects and note bodies, and
 * nothing but an id and a date may survive the parse. So the fixtures below put
 * recognisable text in every field Atom offers — title, summary, content, author
 * — and the tests assert on the exact shape that comes back, which has nowhere
 * to hide a string.
 */
import { describe, it, expect } from 'vitest';

import { activityIssueRefs } from '../server/redmine-atom';

/** One Atom entry, with PHI-shaped text in every free-text field. */
const entry = (issueId: number, updated: string, text = 'Jane Patient blood results') => `
  <entry>
    <title>Bug #${issueId} (New): ${text}</title>
    <link rel="alternate" type="text/html" href="https://redmine.test/issues/${issueId}#note-3"/>
    <id>https://redmine.test/issues/${issueId}#note-3</id>
    <updated>${updated}</updated>
    <author><name>Dr ${text}</name></author>
    <summary type="html">${text}</summary>
    <content type="html">&lt;p&gt;${text}&lt;/p&gt;</content>
  </entry>`;

const feed = (...entries: string[]) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>redmine.test: Activity</title>
  ${entries.join('\n')}
</feed>`;

describe('activityIssueRefs', () => {
  it('returns only the issue id and the entry date', () => {
    expect(activityIssueRefs(feed(entry(1234, '2026-09-20T10:00:00Z')))).toEqual([
      { issueId: 1234, at: '2026-09-20T10:00:00.000Z' },
    ]);
  });

  it('keeps no entry text at all, in any field', () => {
    const parsed = activityIssueRefs(feed(entry(1234, '2026-09-20T10:00:00Z', 'SECRET')));
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
    expect(Object.keys(parsed[0]).sort()).toEqual(['at', 'issueId']);
  });

  it('keeps one ref per entry, so repeats can be dated by the caller', () => {
    const parsed = activityIssueRefs(
      feed(entry(1234, '2026-09-20T10:00:00Z'), entry(1234, '2026-09-22T10:00:00Z'), entry(9, '2026-09-21T10:00:00Z')),
    );
    expect(parsed).toEqual([
      { issueId: 1234, at: '2026-09-20T10:00:00.000Z' },
      { issueId: 1234, at: '2026-09-22T10:00:00.000Z' },
      { issueId: 9, at: '2026-09-21T10:00:00.000Z' },
    ]);
  });

  // Regression: a time-entry event links to the project's time-entry list with
  // the issue as a query parameter, not to the issue path. Reading only the path
  // form discarded 11 of 13 entries against a live feed, silently — the fetch
  // succeeds, so nothing reports a degraded signal. The fixture below is the link
  // shape Redmine actually emitted.
  it('reads the issue id from a time-entry event, not just an issue path', () => {
    const loggedTime = `
      <entry>
        <title>Project Button - 1:00 hour (Bug #2 (Resolved): Jane Patient blood results)</title>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/project-button/time_entries?issue_id=2"/>
        <updated>2026-09-20T10:00:00Z</updated>
        <content type="html">&lt;p&gt;Jane Patient blood results&lt;/p&gt;</content>
      </entry>`;
    expect(activityIssueRefs(feed(loggedTime))).toEqual([
      { issueId: 2, at: '2026-09-20T10:00:00.000Z' },
    ]);
  });

  it('keeps no entry text from a time-entry event either', () => {
    const loggedTime = `
      <entry>
        <title>Project Button - 1:00 hour (Bug #2 (Resolved): SECRET)</title>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/p/time_entries?issue_id=2"/>
        <updated>2026-09-20T10:00:00Z</updated>
        <author><name>Dr SECRET</name></author>
        <summary type="html">SECRET</summary>
      </entry>`;
    const parsed = activityIssueRefs(feed(loggedTime));
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
    expect(Object.keys(parsed[0]).sort()).toEqual(['at', 'issueId']);
  });

  it('reads both link shapes in one feed', () => {
    const loggedTime = `
      <entry>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/p/time_entries?issue_id=17"/>
        <updated>2026-09-21T10:00:00Z</updated>
      </entry>`;
    expect(activityIssueRefs(feed(entry(1234, '2026-09-20T10:00:00Z'), loggedTime))).toEqual([
      { issueId: 1234, at: '2026-09-20T10:00:00.000Z' },
      { issueId: 17, at: '2026-09-21T10:00:00.000Z' },
    ]);
  });

  it('is not fooled by an issue_id parameter inside escaped entry content', () => {
    const sneaky = `
      <entry>
        <title>Wiki edit</title>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/x/wiki/Home"/>
        <updated>2026-09-20T10:00:00Z</updated>
        <content type="html">&lt;a href=&quot;https://redmine.test/x?issue_id=777&quot;&gt;see&lt;/a&gt;</content>
      </entry>`;
    expect(activityIssueRefs(feed(sneaky))).toEqual([]);
  });

  it('ignores a feed-level self link that carries no issue', () => {
    const withSelfLink = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="https://redmine.test/activity.atom?from=2026-09-11&amp;user_id=5"/>
  ${entry(5, '2026-09-20T10:00:00Z')}
</feed>`;
    expect(activityIssueRefs(withSelfLink)).toEqual([
      { issueId: 5, at: '2026-09-20T10:00:00.000Z' },
    ]);
  });

  it('drops entries that are not about an issue', () => {
    const wiki = `
      <entry>
        <title>Wiki edit: Home</title>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/x/wiki/Home"/>
        <updated>2026-09-20T10:00:00Z</updated>
      </entry>`;
    expect(activityIssueRefs(feed(wiki))).toEqual([]);
  });

  it('is not fooled by an issue path inside escaped entry content', () => {
    const sneaky = `
      <entry>
        <title>Wiki edit</title>
        <link rel="alternate" type="text/html" href="https://redmine.test/projects/x/wiki/Home"/>
        <updated>2026-09-20T10:00:00Z</updated>
        <content type="html">&lt;a href=&quot;https://redmine.test/issues/777&quot;&gt;see&lt;/a&gt;</content>
      </entry>`;
    expect(activityIssueRefs(feed(sneaky))).toEqual([]);
  });

  it('reports an undated entry as undated rather than as fresh', () => {
    const undated = `
      <entry>
        <link rel="alternate" type="text/html" href="https://redmine.test/issues/5"/>
        <updated>not a date</updated>
      </entry>`;
    expect(activityIssueRefs(feed(undated))).toEqual([{ issueId: 5, at: null }]);
  });

  it('yields nothing for input that is not a feed', () => {
    for (const raw of ['', '<feed></feed>', null, undefined, 42, {}]) {
      expect(activityIssueRefs(raw as never)).toEqual([]);
    }
  });
});
