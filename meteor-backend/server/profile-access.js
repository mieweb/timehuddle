/**
 * profile-access — Who may look at whose profile.
 *
 * One rule, in one place, because the profile page is not a single request:
 * `users.get` answers the page itself, `media.listForUser` fills its Feed and
 * `activity.userLog` its Activity tab. When those disagreed, an org admin
 * opening a profile from the org chart got the page with a broken Feed and an
 * unavailable Activity tab.
 *
 * The rule: your own profile, a team-mate's, or someone in an organization you
 * run. Sharing an organization is deliberately not enough on its own — every
 * account is auto-joined to one default org, so that would mean everyone.
 */
import { Meteor } from 'meteor/meteor';
import { ObjectId } from 'mongodb';

import { Teams, rawDb, isValidId } from './collections';

/** The non-personal teams both users are in. */
export async function sharedTeamDocs(viewerId, targetUserId) {
  if (viewerId === targetUserId) return [];
  return Teams.rawCollection()
    .find({ members: { $all: [viewerId, targetUserId] }, isPersonal: { $ne: true } })
    .toArray();
}

/** Whether `viewerId` runs an organization `targetUserId` belongs to. */
export async function adminsAnOrgOf(viewerId, targetUserId) {
  const db = rawDb();
  const [memberships, viewer] = await Promise.all([
    db
      .collection('org_members')
      .find({ userId: { $in: [viewerId, targetUserId] } })
      .toArray(),
    db.collection('users').findOne({ _id: String(viewerId) }, { projection: { blocked: 1 } }),
  ]);
  // `orgs.blockMember` keeps the org_members row and its role on purpose, so a
  // blocked former admin still reads as owner/admin here. The block record on
  // the user is the only thing that says otherwise.
  const blockedOrgIds = new Set((viewer?.blocked ?? []).map((b) => b.orgId));
  const runs = new Set(
    memberships
      .filter(
        (m) =>
          m.userId === viewerId &&
          (m.role === 'owner' || m.role === 'admin') &&
          !blockedOrgIds.has(m.orgId),
      )
      .map((m) => m.orgId),
  );
  return memberships.some((m) => m.userId === targetUserId && runs.has(m.orgId));
}

/**
 * Whether `viewerId` owns or administers an enterprise above an organization
 * `targetUserId` belongs to. Enterprise power is held on the enterprise doc,
 * not as an `org_members` row, so the role check above can't see it — and the
 * org chart these people can already open links straight to these profiles.
 */
export async function runsAnEnterpriseOver(viewerId, targetUserId) {
  const db = rawDb();
  const targetOrgIds = (
    await db.collection('org_members').find({ userId: targetUserId }).toArray()
  )
    .map((m) => m.orgId)
    .filter((id) => isValidId(id));
  if (targetOrgIds.length === 0) return false;

  const orgs = await db
    .collection('organizations')
    .find({ _id: { $in: targetOrgIds.map((id) => new ObjectId(id)) } }, { projection: { enterpriseId: 1 } })
    .toArray();
  const enterpriseIds = [
    ...new Set(orgs.map((o) => o.enterpriseId).filter((id) => id && isValidId(id))),
  ];
  if (enterpriseIds.length === 0) return false;

  const match = await db.collection('enterprises').findOne({
    _id: { $in: enterpriseIds.map((id) => new ObjectId(id)) },
    $or: [{ owners: viewerId }, { admins: viewerId }],
  });
  return !!match;
}

export async function canViewProfile(viewerId, targetUserId) {
  if (viewerId === targetUserId) return true;
  const shared = await sharedTeamDocs(viewerId, targetUserId);
  if (shared.length > 0) return true;
  if (await adminsAnOrgOf(viewerId, targetUserId)) return true;
  return runsAnEnterpriseOver(viewerId, targetUserId);
}

/** Throws `forbidden` unless `viewerId` may view `targetUserId`'s profile. */
export async function requireProfileAccess(viewerId, targetUserId, message) {
  if (await canViewProfile(viewerId, targetUserId)) return;
  throw new Meteor.Error('forbidden', message ?? 'You cannot view this profile');
}
