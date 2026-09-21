/**
 * Creating and editing Redmine issues from TimeHuddle (Milestone 6).
 *
 * Every call runs under the caller's own personal API key, so Redmine enforces
 * their role and the tracker's workflow and records them as author/editor —
 * no admin key, no `X-Redmine-Switch-User`. Nothing about an issue is persisted
 * here: reads are live, and only rarely-changing lists (projects, trackers,
 * members, priorities) are held in a short per-user cache.
 *
 * Writes follow the M5 pattern: validate, write, then **read back** and report
 * any field Redmine did not store as sent. Edits carry the `updatedAt` the form
 * was opened with and are refused as `stale` if the issue changed in Redmine
 * meanwhile — Redmine's REST API has no optimistic locking of its own.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineLinks } from './collections';
import { requireIdentity } from './auth-bridge';
import { findRedmineApiKey } from './redmine-account';
import { createUserTtlCache } from './redmine-cache';
import {
  createIssue,
  getIssueDetail,
  listIssuePriorities,
  listProjectMemberships,
  listProjects,
  listProjectTrackers,
  optionalRedmineBaseUrl,
  updateIssue,
} from './redmine-client';
import { toFormOptions, toIssueDetail, toNamedList } from './redmine-issues';
import {
  buildUpdatePayload,
  readBackMismatches,
  validateCreateInput,
  writeFailureReason,
} from './redmine-issue-writes';
import { toRedmineMeteorError } from './redmine';

const FIVE_MINUTES = 5 * 60 * 1000;
const projectsCache = createUserTtlCache(FIVE_MINUTES);
const formOptionsCache = createUserTtlCache(FIVE_MINUTES);
const prioritiesCache = createUserTtlCache(60 * 60 * 1000);

/** What the user is told for each named write failure. */
const WRITE_FAILURE_MESSAGES = {
  'invalid-key': 'Your Redmine API key was rejected. Reconnect it in Settings.',
  'no-permission': "Your Redmine role doesn't allow this change.",
  gone: 'This issue no longer exists, or you can no longer see it in Redmine.',
  rejected: 'Redmine rejected the change.',
  unreachable: 'Could not reach Redmine. Try again in a moment.',
};

/**
 * Turn a failed Redmine write into a Meteor error with a named code. Redmine's
 * own validation messages are folded into `reason`, because the REST bridge
 * forwards only `error` and `reason` to the client.
 */
function toWriteMeteorError(err) {
  const code = writeFailureReason(err);
  const details = Array.isArray(err?.errors) && err.errors.length ? ` ${err.errors.join('. ')}.` : '';
  return new Meteor.Error(code, `${WRITE_FAILURE_MESSAGES[code]}${details}`);
}

/** The caller's API key, or a `not-connected` error. */
async function requireApiKey(userId) {
  const apiKey = await findRedmineApiKey(userId);
  if (!apiKey) throw new Meteor.Error('not-connected', 'Connect your Redmine account first.');
  return apiKey;
}

function requireIssueId(issueId) {
  if (!Number.isInteger(issueId) || issueId <= 0) {
    throw new Meteor.Error('bad-request', 'A Redmine issue id is required.');
  }
}

/** Read one issue's detail DTO, mapping "missing" to a `gone` error. */
async function loadIssueDetail(apiKey, issueId) {
  let raw;
  try {
    raw = await getIssueDetail(apiKey, issueId);
  } catch (err) {
    throw toRedmineMeteorError(err);
  }
  if (!raw) throw new Meteor.Error('gone', WRITE_FAILURE_MESSAGES.gone);
  return toIssueDetail(raw);
}

Meteor.methods({
  /** Projects the caller's key can see, for the create form. */
  async 'redmine.projects.list'() {
    const { userId } = await requireIdentity(this);
    const apiKey = await requireApiKey(userId);

    try {
      const projects = await projectsCache.get(userId, 'projects', async () =>
        toNamedList(await listProjects(apiKey)),
      );
      return { projects };
    } catch (err) {
      throw toRedmineMeteorError(err);
    }
  },

  /**
   * What the create/edit form offers for one project: its trackers, the users
   * an issue can be assigned to, and the instance's priorities. `me` is the
   * caller's Redmine user id, so the form can default the assignee to them.
   */
  async 'redmine.projects.formOptions'({ projectId } = {}) {
    const { userId } = await requireIdentity(this);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new Meteor.Error('bad-request', 'A Redmine project id is required.');
    }
    const apiKey = await requireApiKey(userId);

    let options;
    try {
      options = await formOptionsCache.get(userId, `project:${projectId}`, async () => {
        const [trackers, memberships, priorities] = await Promise.all([
          listProjectTrackers(apiKey, projectId),
          listProjectMemberships(apiKey, projectId),
          prioritiesCache.get(userId, 'priorities', () => listIssuePriorities(apiKey)),
        ]);
        return toFormOptions({ trackers, memberships, priorities });
      });
    } catch (err) {
      throw toRedmineMeteorError(err);
    }

    const link = await RedmineLinks.findOneAsync({ userId }, { fields: { redmineUserId: 1 } });
    return { ...options, me: link?.redmineUserId ?? null };
  },

  /** One issue with its description and the status changes the caller may make. */
  async 'redmine.issues.get'({ issueId } = {}) {
    const { userId } = await requireIdentity(this);
    requireIssueId(issueId);
    const apiKey = await requireApiKey(userId);

    return { baseUrl: optionalRedmineBaseUrl(), issue: await loadIssueDetail(apiKey, issueId) };
  },

  /**
   * Create an issue as the caller. Returns the issue as Redmine stored it.
   * If the read-back fails the issue still exists, so its id is returned with
   * `confirmed: false` rather than an error that would invite a duplicate.
   */
  async 'redmine.issues.create'(input = {}) {
    const { userId } = await requireIdentity(this);
    const validated = validateCreateInput(input);
    if (validated.error) throw new Meteor.Error('bad-request', validated.error);
    const apiKey = await requireApiKey(userId);

    let created;
    try {
      created = await createIssue(apiKey, validated.fields);
    } catch (err) {
      throw toWriteMeteorError(err);
    }
    const issueId = created?.id ?? null;
    if (issueId == null) {
      throw new Meteor.Error('unreachable', 'Redmine did not return the new issue.');
    }

    const baseUrl = optionalRedmineBaseUrl();
    let issue;
    try {
      issue = await loadIssueDetail(apiKey, issueId);
    } catch {
      return { baseUrl, issueId, confirmed: false, issue: null, mismatches: [] };
    }
    return {
      baseUrl,
      issueId,
      confirmed: true,
      issue,
      mismatches: readBackMismatches(validated.fields, issue),
    };
  },

  /**
   * Edit status, priority, assignee and/or description, sending only the fields
   * that changed. Refused as `stale` when the issue's `updatedAt` no longer
   * matches `expectedUpdatedAt` — someone changed it in Redmine since the form
   * opened, and writing now could undo their edit.
   */
  async 'redmine.issues.update'({ issueId, expectedUpdatedAt, edits } = {}) {
    const { userId } = await requireIdentity(this);
    requireIssueId(issueId);
    if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
      throw new Meteor.Error('bad-request', 'expectedUpdatedAt is required.');
    }
    if (!edits || typeof edits !== 'object') {
      throw new Meteor.Error('bad-request', 'Nothing to change.');
    }
    const apiKey = await requireApiKey(userId);

    const current = await loadIssueDetail(apiKey, issueId);
    if (current.updatedAt !== expectedUpdatedAt) {
      throw new Meteor.Error(
        'stale',
        'This issue changed in Redmine since you opened it. Reload to see the latest version.',
      );
    }

    const payload = buildUpdatePayload(current, edits);
    if (payload.error) throw new Meteor.Error('bad-request', payload.error);
    if (Object.keys(payload.fields).length === 0) {
      return { baseUrl: optionalRedmineBaseUrl(), issue: current, mismatches: [] };
    }

    try {
      await updateIssue(apiKey, issueId, payload.fields);
    } catch (err) {
      throw toWriteMeteorError(err);
    }

    const issue = await loadIssueDetail(apiKey, issueId);
    return {
      baseUrl: optionalRedmineBaseUrl(),
      issue,
      mismatches: readBackMismatches(payload.fields, issue),
    };
  },
});
