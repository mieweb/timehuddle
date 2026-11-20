/**
 * `pulseUploads`: the server's record of each video Pulse in the app sends,
 * one row per draft (huddle-server §3). The rules are pure, in
 * pulse-uploads-core.js; this file runs them against the collection.
 *
 *  - The methods (§5): begin, token, cancel, list, retarget, adminList and
 *    pulseUploadTypes.list, defined here and exposed through Wormhole by
 *    pulse-uploads-expose.js, with their schemas and rate limits from
 *    pulse-uploads-expose-core.js.
 *  - The publications (§6): `pulseUploads.mine` and `pulseUploads.forTarget`.
 *  - The PulseVault hooks (§7), called from pulsevault.js with the uploadId
 *    its token carries: an upload's authorize, and its artifact events.
 *    Delivery is pulse-upload-delivery.js.
 *  - For the clock calls at Send (PR3-S9): insertIntent, findDraftRows, and
 *    registerPulseCancelHandler (a row's video won't come).
 *
 * pulsevault.js imports this file for its hooks, so PulseVault is loaded on
 * first use here (mint a token, remove an artifact) instead of imported.
 */
import { randomUUID } from 'crypto';
import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge.js';
import { rawDb, isObjectIdHex } from './collections.js';
import { getOwnedOrgIds, isTeamAdminOrOrgOwner } from './org-helpers.js';
import { requireTeamMembership } from './permissions.js';
import { deliverPulseVideo, resolvePulseDestination } from './pulse-destinations.js';
import { pulseLinkHints } from './pulse-link-hints-core.js';
import { pulseSettingsForTeams } from './pulse-settings-core.js';
import { pulseUploadTypesFor } from './pulse-upload-types.js';
import {
  beginDecision,
  checkBeginArgs,
  destinationRequestOf,
  hookDecision,
  nextState,
  normalizeTarget,
  pulseUploadType,
  sendContextRule,
  targetKeyOf,
  tokenDecision,
} from './pulse-uploads-core.js';
import {
  adminScopeQuery,
  adminUpload,
  checkAdminListArgs,
  checkCancelArgs,
  checkListArgs,
  checkRetargetArgs,
  checkTokenArgs,
  forTargetQuery,
  forTargetScope,
  mineQuery,
  OWN_UPLOAD_FIELDS,
  plainLabelOf,
  PUBLIC_UPLOAD_FIELDS,
  publicUpload,
  pulseUploadMethods,
  sessionAtSendQuery,
  TOO_MANY_PULSE_UPLOAD_CALLS,
} from './pulse-uploads-expose-core.js';
import { idOf, toDocId } from './settings/index.js';
import { CANONICAL_ITEM, cleanVideoName, isDuplicateKey } from './video-names.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/** Writes and reads go through the driver; the publications need a Meteor collection. */
export const PulseUploads = new Mongo.Collection('pulseUploads');
export const pulseUploadsCollection = () => rawDb().collection('pulseUploads');

// pulsevault.js imports this file for its hooks; load it on first use instead.
const vault = () => import('./pulsevault.js');

Meteor.startup(async () => {
  const uploads = pulseUploadsCollection();
  const indexes = [
    // Intent rows have no clientKey until a begin adopts them.
    [{ userId: 1, clientKey: 1 }, { name: 'pulseUploads_user_clientKey', unique: true, partialFilterExpression: { clientKey: { $type: 'string' } } }],
    [{ artifactId: 1 }, { name: 'pulseUploads_artifactId', unique: true, partialFilterExpression: { artifactId: { $type: 'string' } } }],
    // Events on an older artifact of a row (renewed, or replaced by an Edit) find it.
    [{ replacedArtifactIds: 1 }, { name: 'pulseUploads_replaced' }],
    [{ userId: 1, draftKey: 1, state: 1 }, { name: 'pulseUploads_user_draftKey' }],
    [{ targetKey: 1, state: 1, updatedAt: -1 }, { name: 'pulseUploads_targetKey_state' }],
    [{ userId: 1, state: 1, updatedAt: -1 }, { name: 'pulseUploads_user_state_updated' }],
  ];
  for (const [keys, options] of indexes) {
    try {
      await uploads.createIndex(keys, options);
    } catch (error) {
      console.error(`[pulse-uploads] index ${options.name} not created:`, error.message);
    }
  }
});

/** Where Pulse uploads to: this server's PulseVault mount. */
function vaultEndpoint() {
  return `${(process.env.ROOT_URL ?? '').replace(/\/+$/, '')}/pulsevault`;
}

/** Why a row stopped, as support and the uploader read it. */
const END_REASONS = {
  canceled: 'Sending was cancelled',
  edited: 'An edited version replaced it',
  deleted: 'The draft was deleted',
  abandoned: 'The upload stopped before the video arrived',
};

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Move `row` to `to` if nothing moved it meanwhile; whether it moved. */
async function moveRow(row, to, fields = {}) {
  const { modifiedCount } = await pulseUploadsCollection().updateOne(
    { _id: row._id, state: row.state },
    { $set: { state: to, updatedAt: new Date(), ...fields } },
  );
  return modifiedCount > 0;
}

/** Remove an artifact this server minted and no longer wants; best-effort, idempotent. */
async function removeArtifact(artifactId) {
  if (!artifactId) return;
  const { removeVideoArtifacts } = await vault();
  await removeVideoArtifacts(artifactId);
}

const cancelHandlers = [];

/**
 * Run `fn({ row, from, to, reason })` whenever a row stops before its video
 * landed: `to` is `canceled` or `abandoned`, `reason` one of `canceled`,
 * `edited`, `deleted` (pulseUploads.cancel, or a newer Send of the draft) or
 * `abandoned` (PulseVault removed the unfinished upload). `row` is the row as
 * it was. A clock row's post is marked missing its video here (§9.4,
 * PR3-S9). A handler that throws is logged; the row has moved already. A row
 * can stop twice (cancelled, then its draft deleted), so handlers are
 * idempotent.
 */
export function registerPulseCancelHandler(fn) {
  if (typeof fn !== 'function') throw new TypeError('registerPulseCancelHandler takes a function');
  cancelHandlers.push(fn);
}

/**
 * Stop `row` (`to`: canceled or abandoned) for `reason`: its artifact
 * removed while no bytes landed (`removeUpload`; PulseVault already did on
 * its own abandon), then the cancel handlers. Whether it moved.
 */
async function stopRow(row, to, reason, { removeUpload = true } = {}) {
  if (!(await moveRow(row, to, { reason: END_REASONS[reason] ?? reason }))) return false;
  if (removeUpload && (row.state === 'reserved' || row.state === 'uploading')) await removeArtifact(row.artifactId);
  for (const handler of cancelHandlers) {
    try {
      await handler({ row, from: row.state, to, reason });
    } catch (err) {
      console.error(`[pulse-uploads] a cancel handler failed for ${row._id}:`, err);
    }
  }
  return true;
}

/** The caller's rows for one draft, any state (pulse-uploads-core.js's beginDecision and intentDecision take these). */
export function findDraftRows(userId, draftKey) {
  return pulseUploadsCollection().find({ userId, draftKey }).toArray();
}

/**
 * The row a clock call at Send makes (`intent`, §9; PR3-S9 decides first,
 * with intentDecision, that there should be one). Its video attaches to the
 * post the call made or appended to (`postId`), and the begin that follows
 * adopts it by draftKey. Returns the row.
 */
export async function insertIntent({
  userId,
  draftKey,
  uploadType,
  target,
  sentAt,
  postId = null,
  clockEventId = null,
  teamId = null,
  name = null,
  bytes = null,
  label = null,
}) {
  const type = pulseUploadType(uploadType);
  const normalized = normalizeTarget(uploadType, target);
  const targetKey = normalized && targetKeyOf(uploadType, normalized, userId);
  if (!type?.clock || !targetKey) throw new Meteor.Error('bad-request', 'Not a clock upload');
  const now = new Date();
  const row = {
    ...emptyRow(now),
    _id: randomUUID(),
    userId,
    clientKey: null,
    draftKey,
    type: uploadType,
    target: normalized,
    targetKey,
    destination: { kind: 'session-post', postId, role: type.clock === 'stop' ? 'wrapup' : 'plan' },
    teamId: teamId ?? normalized.teamId ?? null,
    label: label ?? plainLabelOf(uploadType),
    sentAt: new Date(sentAt),
    postId,
    clockEventId: clockEventId ?? (normalized.kind === 'clock' ? normalized.id : null),
    name: cleanVideoName(name),
    bytes,
    state: nextState(null, { type: 'intent' }),
    attempts: 0,
  };
  await pulseUploadsCollection().insertOne(row);
  return row;
}

/** Every field a new row starts with. */
function emptyRow(now) {
  return {
    conversationId: null,
    sessionId: null,
    postId: null,
    clockEventId: null,
    artifactId: null,
    replacedArtifactIds: [],
    replacedClientKeys: [],
    name: null,
    durationMs: null,
    bytes: null,
    appVersion: null,
    contractVersion: null,
    platform: null,
    source: 'pulse-embed',
    reason: null,
    note: null,
    fallback: null,
    mediaId: null,
    attachmentId: null,
    captionsArtifactId: null,
    tokenIssuedAt: null,
    overdueAt: null,
    createdAt: now,
    updatedAt: now,
    deliveredAt: null,
  };
}

// ─── Places ──────────────────────────────────────────────────────────────────

/**
 * Check where a video goes (`deliverAs`' destination, for `target`) for
 * `userId`: `{ resolved, names }` (resolvePulseDestination), or null for a
 * clock type's own post, made at Send. Throws its refusal.
 */
async function resolvePlace(userId, deliverAs, target) {
  const request = destinationRequestOf(deliverAs, target);
  return request ? resolvePulseDestination(userId, request) : null;
}

/** What the place is called, for support and the push (§3 `label`). */
function labelOf(userId, typeId, place) {
  return pulseLinkHints(userId, place.resolved, place.names)?.label ?? plainLabelOf(typeId);
}

/** The team a resolved destination belongs to (publication and admin scope), or null. */
async function teamOfPlace(resolved) {
  switch (resolved?.kind) {
    case 'huddle':
    case 'clock-plan':
      return resolved.teamId ?? null;
    case 'ticket':
    case 'clock': {
      if (!isObjectIdHex(resolved.id)) return null;
      const collection = resolved.kind === 'ticket' ? 'tickets' : 'clockevents';
      const doc = await rawDb()
        .collection(collection)
        .findOne({ _id: new ObjectId(resolved.id) }, { projection: { teamId: 1 } });
      return doc?.teamId != null ? String(doc.teamId) : null;
    }
    default:
      return null;
  }
}

/**
 * The conversation a Huddle video was sent to (H4, §8.1). The base has no
 * conversations until #871 lands, so this is null and delivery posts as it
 * does today. PR3-R fills it in after the rebase: a group or direct
 * conversation the uploader can see (Q14), else the workday open at `sentAt`
 * (workdayAt).
 */
// eslint-disable-next-line no-unused-vars
async function conversationAtSend(userId, target, sentAt) {
  return null;
}

/**
 * The clock session a Huddle video was sent in (H4): found at begin, within
 * 5 minutes of Send the one open now, later the one open at `sentAt`
 * (sendContextRule). Only a post joins a session; other types have none.
 */
async function sessionAtSend(userId, deliverAs, target, sentAt, now) {
  if (pulseUploadType(deliverAs)?.destinationKind !== 'huddle') return null;
  const rule = sendContextRule(sentAt, now);
  const session = await rawDb()
    .collection('clockevents')
    .findOne(sessionAtSendQuery(userId, target.teamId, sentAt, rule), {
      sort: { startTime: -1 },
      projection: { _id: 1 },
    });
  return session ? idOf(session._id) : null;
}

// ─── begin ───────────────────────────────────────────────────────────────────

/** How many times a begin starts over when another write to the draft's row won the race. */
const BEGIN_RETRIES = 2;

async function begin({ userId }, args, retry = 0) {
  const now = Date.now();
  const checked = checkBeginArgs(userId, args, now);
  if (checked.error) throw new Meteor.Error(checked.error, checked.reason);
  const value = checked.value;
  const rows = await findDraftRows(userId, value.draftKey);
  const decision = beginDecision(rows, value);
  if (decision.error) throw new Meteor.Error(decision.error, decision.reason);
  const { row } = decision;

  let place = null;
  if (decision.resolveTarget) {
    try {
      place = await resolvePlace(userId, decision.deliverAs, value.target);
    } catch (err) {
      await recordRefusal(userId, value, row, err);
      throw err;
    }
  }

  const startOver = () => {
    if (retry >= BEGIN_RETRIES) {
      throw new Meteor.Error('conflict', 'That video changed while it was being sent. Try again.');
    }
    return begin({ userId }, args, retry + 1);
  };

  let uploadId = row?._id ?? null;
  let artifactId = row?.artifactId ?? null;
  let label = row?.label ?? plainLabelOf(value.type);
  const nowDate = new Date(now);

  if (decision.action === 'reuse') {
    await pulseUploadsCollection().updateOne({ _id: row._id }, { $set: { tokenIssuedAt: nowDate } });
  } else if (decision.mintArtifact) {
    artifactId = randomUUID();
    const sentAt = new Date(decision.sentAt);
    const fields = {
      clientKey: value.clientKey,
      type: value.type,
      target: value.target,
      targetKey: value.targetKey,
      state: decision.state,
      sentAt,
      fallback: decision.fallback,
      artifactId,
      name: cleanVideoName(value.name) ?? row?.name ?? null,
      durationMs: value.durationMs ?? row?.durationMs ?? null,
      bytes: value.bytes ?? row?.bytes ?? null,
      appVersion: value.client.appVersion ?? row?.appVersion ?? null,
      contractVersion: value.client.contractVersion ?? row?.contractVersion ?? null,
      platform: value.client.platform ?? row?.platform ?? null,
      reason: null,
      tokenIssuedAt: nowDate,
      updatedAt: nowDate,
      clockEventId: value.target.kind === 'clock' ? value.target.id : (row?.clockEventId ?? null),
    };
    if (place) {
      label = labelOf(userId, value.type, place);
      Object.assign(fields, { destination: place.resolved, label, teamId: await teamOfPlace(place.resolved) });
    }
    if (decision.resolveSendContext) {
      // H4: decided once, here, from the Send; delivery never looks again.
      fields.sessionId = await sessionAtSend(userId, decision.deliverAs, value.target, sentAt.getTime(), now);
      fields.conversationId = await conversationAtSend(userId, value.target, sentAt.getTime());
    }

    if (!row) {
      uploadId = randomUUID();
      try {
        await pulseUploadsCollection().insertOne({
          ...emptyRow(nowDate),
          _id: uploadId,
          userId,
          draftKey: value.draftKey,
          destination: null,
          teamId: null,
          label,
          ...fields,
          attempts: 1,
        });
      } catch (err) {
        // The same Send twice at once: the other one made the row.
        if (isDuplicateKey(err)) return startOver();
        throw err;
      }
    } else {
      const replacedArtifactIds = [
        ...(row.replacedArtifactIds ?? []),
        ...(decision.retireArtifactId ? [decision.retireArtifactId] : []),
      ];
      const replacedClientKeys = [
        ...(row.replacedClientKeys ?? []).filter((key) => key !== decision.reviveClientKey),
        ...(decision.retireClientKey ? [decision.retireClientKey] : []),
      ];
      const { matchedCount } = await pulseUploadsCollection().updateOne(
        // Only the row as this begin read it: a hook or another begin that
        // moved it meanwhile makes this one start over.
        { _id: row._id, state: row.state, clientKey: row.clientKey ?? null, artifactId: row.artifactId ?? null },
        { $set: { ...fields, replacedArtifactIds, replacedClientKeys }, $inc: { attempts: 1 } },
      );
      if (!matchedCount) return startOver();
      // Nothing more may land under the old artifact.
      if (decision.retireArtifactId) await removeArtifact(decision.retireArtifactId);
    }
  }

  // Older attempts of this draft still under way end here (an Edit's).
  for (const { _id, reason } of decision.cancel ?? []) {
    const older = rows.find((r) => r._id === _id);
    const to = older && nextState(older, { type: 'cancel', reason });
    if (to && to !== older.state) await stopRow(older, to, reason);
  }

  const { mintPulseUploadToken } = await vault();
  const { token, expiresAt } = mintPulseUploadToken(artifactId, uploadId, userId);
  return {
    uploadId,
    clientKey: value.clientKey,
    artifactId,
    endpoint: vaultEndpoint(),
    token,
    expiresAt,
    state: decision.state,
    label,
  };
}

/**
 * The team a refused row is filed under: the target's team, but only when the
 * person is a member of it. A refusal from outside the team (a removed member,
 * a stale link) stays team-less, so it never reaches that team's admins.
 */
async function refusalTeam(userId, target) {
  const teamId = await teamOfPlace(target);
  if (!teamId) return null;
  try {
    await requireTeamMembership(userId, String(teamId));
    return String(teamId);
  } catch {
    return null;
  }
}

/**
 * A place refused at begin (not found, forbidden): recorded as a `failed`
 * row for support when the draft has none yet, and on the draft's failed
 * row when it is one, so a retry checks the place again. A row under way
 * that a Move to… was refused for stays as it is. Nothing else is written.
 * The row carries the team the target names (a Huddle post's or a plan's
 * teamId, or the ticket's or session's team while it still exists) when the
 * person belongs to it, so that team's admins find it and count it as failed.
 */
async function recordRefusal(userId, value, row, err) {
  if (!(err instanceof Meteor.Error) || (err.error !== 'not-found' && err.error !== 'forbidden')) return;
  const reason = err.reason ?? err.message;
  const now = new Date();
  if (row) {
    if (row.state === 'failed') {
      await pulseUploadsCollection().updateOne({ _id: row._id, state: 'failed' }, { $set: { reason, updatedAt: now } });
    }
    return;
  }
  try {
    await pulseUploadsCollection().insertOne({
      ...emptyRow(now),
      _id: randomUUID(),
      userId,
      clientKey: value.clientKey,
      draftKey: value.draftKey,
      type: value.type,
      target: value.target,
      targetKey: value.targetKey,
      destination: null,
      teamId: await refusalTeam(userId, value.target),
      label: plainLabelOf(value.type),
      sentAt: new Date(value.sentAt),
      name: cleanVideoName(value.name),
      durationMs: value.durationMs,
      bytes: value.bytes,
      ...value.client,
      state: nextState(null, { type: 'refused' }),
      reason,
      attempts: 0,
    });
  } catch (insertErr) {
    if (!isDuplicateKey(insertErr)) console.error('[pulse-uploads] recording a refusal failed:', insertErr);
  }
}

// ─── The other methods ───────────────────────────────────────────────────────

function refuse(checked) {
  if (checked.error) throw new Meteor.Error(checked.error, checked.reason);
  return checked.value;
}

/** The caller's row by id, or not-found. */
async function ownRow(userId, uploadId) {
  const row = await pulseUploadsCollection().findOne({ _id: uploadId, userId });
  if (!row) throw new Meteor.Error('not-found', 'Upload not found');
  return row;
}

async function token({ userId }, args) {
  const { uploadId, clientKey } = refuse(checkTokenArgs(args));
  const row = await ownRow(userId, uploadId);
  refuse(tokenDecision(row, { clientKey }));
  const { mintPulseUploadToken } = await vault();
  const minted = mintPulseUploadToken(row.artifactId, row._id, userId);
  await pulseUploadsCollection().updateOne({ _id: row._id }, { $set: { tokenIssuedAt: new Date() } });
  return minted;
}

async function cancel({ userId }, args) {
  const { uploadId, clientKey, reason } = refuse(checkCancelArgs(args));
  const row = uploadId
    ? await ownRow(userId, uploadId)
    : await pulseUploadsCollection().findOne({ userId, $or: [{ clientKey }, { replacedClientKeys: clientKey }] });
  if (!row) throw new Meteor.Error('not-found', 'Upload not found');
  const to = nextState(row, { type: 'cancel', reason, clientKey });
  if (!to || to === row.state) return { state: row.state };
  if (await stopRow(row, to, reason)) return { state: to };
  // Something moved it first (its bytes landed, say): say where it is now.
  const now = await pulseUploadsCollection().findOne({ _id: row._id }, { projection: { state: 1 } });
  return { state: now?.state ?? row.state };
}

async function list({ userId }, args) {
  const { query, limit } = refuse(checkListArgs(userId, args));
  const rows = await pulseUploadsCollection().find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
  return { uploads: rows.map((row) => publicUpload(row, { own: true })) };
}

/** A kept video as pulse-destinations.js delivers it, from its media item. */
async function keptVideo(row) {
  const item = await rawDb()
    .collection('mediaitems')
    .findOne({ videoid: row.artifactId }, { ...CANONICAL_ITEM });
  if (!item) throw new Meteor.Error('conflict', 'That video is no longer in your library');
  return {
    artifactId: row.artifactId,
    url: item.url ?? `/pulsevault/artifacts/${row.artifactId}`,
    name: item.title ?? row.name ?? null,
    title: `Video ${row.artifactId.slice(0, 8)}`,
    filename: item.filename,
    mimeType: item.mimeType ?? 'video/mp4',
    size: item.size ?? 0,
  };
}

async function retarget({ userId }, args) {
  const value = refuse(checkRetargetArgs(userId, args));
  const row = await ownRow(userId, value.uploadId);
  if (nextState(row, { type: 'retarget' }) !== 'delivered') {
    throw new Meteor.Error('conflict', 'Only a video kept in your library can be sent somewhere else');
  }
  const place = await resolvePlace(userId, value.type, value.target);
  const outcome = await deliverPulseVideo(userId, place.resolved, await keptVideo(row));
  if (outcome.state !== 'done') throw new Meteor.Error('not-found', outcome.reason);
  const now = new Date();
  const { matchedCount } = await pulseUploadsCollection().updateOne(
    { _id: row._id, state: 'kept' },
    {
      $set: {
        type: value.type,
        target: value.target,
        targetKey: value.targetKey,
        destination: place.resolved,
        label: labelOf(userId, value.type, place),
        teamId: await teamOfPlace(place.resolved),
        clockEventId: value.target.kind === 'clock' ? value.target.id : null,
        fallback: null,
        state: 'delivered',
        note: outcome.note,
        reason: null,
        deliveredAt: now,
        updatedAt: now,
      },
    },
  );
  if (!matchedCount) throw new Meteor.Error('conflict', 'That video was moved already');
  return { state: 'delivered', note: outcome.note };
}

/** What a user is called in the admin list. */
const userNameOf = (user) => user?.profile?.name || user?.emails?.[0]?.address || null;

async function adminList({ userId }, args) {
  const { query, limit } = refuse(checkAdminListArgs(args));
  const ownedOrgIds = await getOwnedOrgIds(userId);
  const adminTeams = await rawDb()
    .collection('teams')
    .find({ $or: [{ admins: userId }, ...(ownedOrgIds.length ? [{ orgId: { $in: ownedOrgIds } }] : [])] }, { projection: { _id: 1 } })
    .toArray();
  const rows = await pulseUploadsCollection()
    .find({ $and: [query, adminScopeQuery(userId, adminTeams.map((team) => idOf(team._id)))] })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const users = await rawDb()
    .collection('users')
    .find({ _id: { $in: userIds } }, { projection: { profile: 1, emails: 1 } })
    .toArray();
  const names = new Map(users.map((user) => [String(user._id), userNameOf(user)]));
  return { uploads: rows.map((row) => adminUpload(row, names.get(row.userId) ?? null)) };
}

const TEAM_FIELDS = { _id: 1, orgId: 1, parentTeamId: 1, isPersonal: 1, settings: 1 };
const MAX_TEAM_DEPTH = 10;

/** The caller's teams with what their Pulse settings inherit from, for pulseSettingsForTeams. */
async function pulseSettingsLevels(userId) {
  const db = rawDb();
  const teams = await db
    .collection('teams')
    .find({ $or: [{ members: userId }, { admins: userId }] }, { projection: TEAM_FIELDS })
    .toArray();
  const known = new Set(teams.map((team) => idOf(team._id)));
  const ancestorTeams = [];
  let parents = teams;
  for (let depth = 0; depth < MAX_TEAM_DEPTH; depth += 1) {
    const missing = [...new Set(parents.map((team) => team.parentTeamId).filter((id) => id && !known.has(id)))];
    if (!missing.length) break;
    missing.forEach((id) => known.add(id));
    parents = await db.collection('teams').find({ _id: { $in: missing.map(toDocId) } }, { projection: TEAM_FIELDS }).toArray();
    ancestorTeams.push(...parents);
  }
  const orgIds = [...new Set([...teams, ...ancestorTeams].map((team) => team.orgId).filter(Boolean))];
  const orgs = orgIds.length
    ? await db
        .collection('organizations')
        .find({ _id: { $in: orgIds.map(toDocId) } }, { projection: { _id: 1, enterpriseId: 1, settings: 1, settingsLocks: 1 } })
        .toArray()
    : [];
  const enterpriseIds = [...new Set(orgs.map((org) => org.enterpriseId).filter(Boolean))];
  const enterprises = enterpriseIds.length
    ? await db
        .collection('enterprises')
        .find({ _id: { $in: enterpriseIds.map(toDocId) } }, { projection: { _id: 1, settings: 1, settingsLocks: 1 } })
        .toArray()
    : [];
  return { teams, ancestorTeams, orgs, enterprises };
}

/**
 * The types, whether Pulse in the app is paused for everyone, and each of the
 * caller's teams' Pulse settings. The client reads it once at start and on
 * resume (AD34). `runtimePaused` is the `appFlags` document `{ _id: 'pulse',
 * runtimePaused }`, so it is switched without a deploy; off when missing.
 */
async function typesList({ userId }) {
  const [levels, flag] = await Promise.all([
    pulseSettingsLevels(userId),
    rawDb().collection('appFlags').findOne({ _id: 'pulse' }, { projection: { runtimePaused: 1 } }),
  ]);
  return {
    types: pulseUploadTypesFor({ mayClock: levels.teams.length > 0 }),
    runtimePaused: flag?.runtimePaused === true,
    teams: pulseSettingsForTeams(levels),
  };
}

/** Every method, signed in and rate-limited; pulse-uploads-expose.js exposes them through Wormhole. */
export const PULSE_UPLOAD_METHOD_MAP = pulseUploadMethods(
  {
    'pulseUploads.begin': (identity, args) => begin(identity, args),
    'pulseUploads.token': token,
    'pulseUploads.cancel': cancel,
    'pulseUploads.list': list,
    'pulseUploads.retarget': retarget,
    'pulseUploads.adminList': adminList,
    'pulseUploadTypes.list': typesList,
  },
  {
    requireIdentity,
    tooManyRequests: (retryAfterMs) =>
      new Meteor.Error(TOO_MANY_PULSE_UPLOAD_CALLS.error, TOO_MANY_PULSE_UPLOAD_CALLS.reason, {
        timeToReset: retryAfterMs,
      }),
  },
);

Meteor.methods(PULSE_UPLOAD_METHOD_MAP);

// ─── Publications ────────────────────────────────────────────────────────────

/** The caller's uploads on their way, and those that landed in the last 7 days, with their keys. */
Meteor.publish('pulseUploads.mine', function () {
  if (!this.userId) return this.ready();
  return PulseUploads.find(mineQuery(this.userId, Date.now()), { fields: OWN_UPLOAD_FIELDS });
});

/**
 * Whether `userId` may see who is sending to a ticket or a session: a ticket
 * to anyone who can read its team; a session to its owner and its team's
 * admins (and the org's owners).
 */
async function maySeeTarget(userId, { check, id }) {
  if (!isObjectIdHex(id)) return false;
  if (check === 'ticket') {
    const ticket = await rawDb()
      .collection('tickets')
      .findOne({ _id: new ObjectId(id), status: { $ne: 'deleted' } }, { projection: { teamId: 1 } });
    if (!ticket) return false;
    try {
      await requireTeamMembership(userId, String(ticket.teamId ?? ''));
      return true;
    } catch {
      return false;
    }
  }
  const session = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(id) }, { projection: { userId: 1, teamId: 1 } });
  if (!session) return false;
  if (session.userId === userId) return true;
  const team = await rawDb().collection('teams').findOne({ _id: toDocId(String(session.teamId)) });
  return !!team && isTeamAdminOrOrgOwner({ ...team, admins: team.admins ?? [] }, userId);
}

/**
 * Videos on their way to one place (`targetKey`), for a page that shows it:
 * "Uploading from iPhone…" on a ticket. A ticket's and a session's are
 * everyone's who may see them; any other key (a Huddle team's, a plan's, a
 * library's) shows only the caller's own, since a direct conversation's
 * pending video must not reach the whole team (#871 R21).
 */
Meteor.publish('pulseUploads.forTarget', async function (targetKey) {
  if (!this.userId) return this.ready();
  const scope = forTargetScope(targetKey);
  if (!scope) throw new Meteor.Error('bad-request', 'Invalid targetKey');
  if (scope.check === 'own') {
    return PulseUploads.find(forTargetQuery(targetKey, this.userId), { fields: PUBLIC_UPLOAD_FIELDS });
  }
  if (!(await maySeeTarget(this.userId, scope))) return this.ready();
  return PulseUploads.find(forTargetQuery(targetKey), { fields: PUBLIC_UPLOAD_FIELDS });
});

// ─── PulseVault hooks ────────────────────────────────────────────────────────

const refused = () => Object.assign(new Error('That upload is no longer open'), { statusCode: 403 });

/**
 * PulseVault's `authorize` for an upload whose token names a row
 * (`uploadId`): on a create or a patch, a cancelled or abandoned row, an
 * older artifact of the row, or a token of someone else's refuses it (403);
 * the video's create moves a reserved row to uploading. Captions, the
 * manifest and the thumbnail go up under the same token and never move it.
 */
export async function pulseUploadAuthorized({ uploadId, userId, artifactId, phase, kind }) {
  if (phase !== 'create' && phase !== 'patch') return;
  const row = await pulseUploadsCollection().findOne({ _id: uploadId });
  // Gone (its account was deleted) or not the token's: nothing may land.
  if (!row || (userId != null && row.userId !== userId)) throw refused();
  const decision = hookDecision(row, { type: 'authorize', phase, artifactId }, kind === 'video');
  if (decision.action === 'refuse') throw refused();
  if (decision.action === 'move') await moveRow(row, decision.state);
}

/**
 * PulseVault's `onArtifactEvent`, for a row's artifact (or an older one of
 * it): the video's `complete` moves the row to processing; a `remove` of an
 * unfinished upload by the retention sweep (`abandoned`) stops it. Anything
 * else, and any artifact no row has (the link flow), changes nothing.
 */
export async function pulseArtifactEvent(event) {
  if (event.phase !== 'complete' && event.phase !== 'remove') return;
  const row = await pulseUploadsCollection().findOne({
    $or: [{ artifactId: event.artifactId }, { replacedArtifactIds: event.artifactId }],
  });
  if (!row) return;
  const decision = hookDecision(
    row,
    { type: event.phase, reason: event.reason, artifactId: event.artifactId },
    event.kind === 'video',
  );
  if (decision.action !== 'move') return;
  if (decision.state === 'abandoned') await stopRow(row, 'abandoned', 'abandoned', { removeUpload: false });
  else await moveRow(row, decision.state);
}
