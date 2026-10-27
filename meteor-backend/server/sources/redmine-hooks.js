/**
 * Redmine's named hooks for the driver engine (#734 step 3): what Redmine's
 * definition can't say as a path. Each wraps code the Redmine features already
 * use, nothing rewritten. `ctx` is `{ userId, account }` (see `registry.js`).
 *
 * `redmineSendTime` has no implementation here yet: time is still sent by
 * `redmine.push` in redmine.js, and moves onto the engine in #734 step 6.
 */
import { updateIssue } from '../redmine-client';
import { loadJournals, loadTimeEntries, toWriteMeteorError } from '../redmine-issue-methods';
import { toConversation, toIssueDetail } from '../redmine-issues';
import { buildUpdatePayload, fromRecordEdits, readBackMismatches } from '../redmine-issue-writes';

import { EngineError } from './engine';

export const redmineHooks = {
  /**
   * Redmine 4.1+ sends `is_closed` with a status. Older servers don't, and a
   * status without it reads as open, as the Tickets list reads it.
   */
  redmineIsClosed: (status) => status?.is_closed === true,

  /** The issue's history and the time logged on it in Redmine, as one conversation. */
  async redmineJournals(raw, { userId, account }) {
    const [journals, timeEntries] = await Promise.all([
      loadJournals(userId, account, raw),
      loadTimeEntries(userId, account, raw.id),
    ]);
    return toConversation(journals, timeEntries ?? []);
  },

  /**
   * Today's issue write: only the fields that changed, a status only if the
   * member may move to it, then a read-back for what Redmine didn't store.
   */
  async redmineWrite({ raw, edits }, { account, reload }) {
    const payload = buildUpdatePayload(toIssueDetail(raw), fromRecordEdits(edits));
    if (payload.error) throw new EngineError('bad-request', payload.error);
    if (Object.keys(payload.fields).length === 0) return { raw, mismatches: [] };
    try {
      await updateIssue(account, raw.id, payload.fields);
    } catch (err) {
      throw toWriteMeteorError(err);
    }
    const fresh = await reload();
    if (!fresh) throw toWriteMeteorError({ status: 404 });
    return { raw: fresh, mismatches: readBackMismatches(payload.fields, toIssueDetail(fresh)) };
  },
};

