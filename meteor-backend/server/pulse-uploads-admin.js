/**
 * `pulseUploads.metrics` (PLAN §7.2 Metrics): how a team's Pulse videos from
 * the app are doing, for its admins' support section (Settings → Team). The
 * pipelines and the math are pure, in pulse-uploads-admin-core.js; this file
 * checks the caller and runs them. pulse-uploads-expose.js exposes it through
 * Wormhole with the other pulseUploads methods.
 *
 * The support list itself is `pulseUploads.adminList` (pulse-uploads.js).
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge.js';
import { isObjectIdHex, rawDb } from './collections.js';
import { isTeamAdminOrOrgOwner } from './org-helpers.js';
import {
  checkMetricsArgs,
  duplicateAttachmentsPipeline,
  duplicateCounts,
  metricsPipeline,
  metricsReport,
  PULSE_UPLOAD_ADMIN_METHODS,
} from './pulse-uploads-admin-core.js';
import { pulseUploadMethods, TOO_MANY_PULSE_UPLOAD_CALLS } from './pulse-uploads-expose-core.js';
import { pulseUploadsCollection } from './pulse-uploads.js';
import { idOf } from './settings/index.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function refuse(checked) {
  if (checked.error) throw new Meteor.Error(checked.error, checked.reason);
  return checked.value;
}

/** The team, by either id shape a team can have. */
async function findTeam(teamId) {
  const teams = rawDb().collection('teams');
  const projection = { _id: 1, admins: 1, orgId: 1 };
  return (
    (await teams.findOne({ _id: teamId }, { projection })) ??
    (isObjectIdHex(teamId) ? await teams.findOne({ _id: new ObjectId(teamId.toLowerCase()) }, { projection }) : null)
  );
}

async function metrics({ userId }, args) {
  const now = Date.now();
  const { teamId, since } = refuse(checkMetricsArgs(args, now));
  const team = await findTeam(teamId);
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  if (!(await isTeamAdminOrOrgOwner({ ...team, admins: team.admins ?? [] }, userId))) {
    throw new Meteor.Error('forbidden', 'Only team admins and organization owners can see Pulse upload metrics');
  }
  // Rows store the team's id as a string (idOf), whichever shape it has.
  const storedTeamId = idOf(team._id);
  const rows = await pulseUploadsCollection().aggregate(metricsPipeline({ teamId: storedTeamId, since })).toArray();
  const delivered = rows.filter((row) => row.state === 'delivered').map((row) => String(row._id));
  const duplicates = delivered.length
    ? duplicateCounts(
        await rawDb().collection('attachments').aggregate(duplicateAttachmentsPipeline(delivered)).toArray(),
      )
    : undefined;
  return metricsReport({ teamId: storedTeamId, since, now, rows, duplicates });
}

/** The admin methods, signed in and rate-limited; pulse-uploads-expose.js exposes them through Wormhole. */
export const PULSE_UPLOAD_ADMIN_METHOD_MAP = pulseUploadMethods(
  { 'pulseUploads.metrics': metrics },
  {
    requireIdentity,
    specs: PULSE_UPLOAD_ADMIN_METHODS,
    tooManyRequests: (retryAfterMs) =>
      new Meteor.Error(TOO_MANY_PULSE_UPLOAD_CALLS.error, TOO_MANY_PULSE_UPLOAD_CALLS.reason, {
        timeToReset: retryAfterMs,
      }),
  },
);

Meteor.methods(PULSE_UPLOAD_ADMIN_METHOD_MAP);
