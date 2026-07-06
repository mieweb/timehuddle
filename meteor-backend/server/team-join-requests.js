import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Teams, TeamJoinRequests, rawDb, isValidId } from './collections';
import { requireIdentity, identityForConnection, findUserById } from './auth-bridge';
import { createNotification } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function toPublicJoinRequest(doc) {
  const id = doc._id?.toHexString ? doc._id.toHexString() : String(doc._id);
  return {
    id,
    teamId: doc.teamId,
    userId: doc.userId,
    teamCode: doc.teamCode,
    status: doc.status,
    requestedAt: doc.requestedAt instanceof Date ? doc.requestedAt.toISOString() : String(doc.requestedAt),
    respondedAt: doc.respondedAt instanceof Date ? doc.respondedAt.toISOString() : undefined,
    respondedBy: doc.respondedBy,
  };
}

async function resolveUserMap(userIds) {
  if (userIds.length === 0) return new Map();
  const userMap = new Map();
  await Promise.all(
    userIds.map(async (id) => {
      const user = await findUserById(id);
      if (user) userMap.set(id, user);
    })
  );
  return userMap;
}

async function notifyTeamAdmins(teamId, requesterId, requestId) {
  const team = await Teams.rawCollection().findOne({ _id: new ObjectId(teamId) });
  if (!team?.admins?.length) return;

  const requester = await findUserById(requesterId);
  const requesterName = requester?.name ?? 'Someone';

  for (const adminId of team.admins) {
    await createNotification({
      userId: adminId,
      title: 'New team join request',
      body: `${requesterName} wants to join ${team.name}`,
      data: {
        type: 'team-join-request',
        teamId: team._id.toHexString(),
        requesterId,
        requestId,
        url: `/app/teams?tab=pending&teamId=${team._id.toHexString()}`,
      },
    });
  }
}

Meteor.publish('teamJoinRequests.forUser', function () {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  return TeamJoinRequests.find({ userId: identity.userId, status: 'pending' });
});

Meteor.publish('teamJoinRequests.forTeam', function (teamId) {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  if (!isValidId(teamId)) return this.ready();
  const team = Teams.findOne(new MongoInternals.NpmModules.mongodb.module.ObjectId(teamId));
  if (!team || !team.admins?.includes(identity.userId)) return this.ready();
  return TeamJoinRequests.find({ teamId, status: 'pending' });
});

Meteor.methods({
  async 'teams.getPendingJoinRequests'({ teamId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Invalid team id');

    const team = await Teams.rawCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }

    const requests = await TeamJoinRequests.rawCollection()
      .find({ teamId, status: 'pending' })
      .sort({ requestedAt: -1 })
      .toArray();

    const userMap = await resolveUserMap(requests.map((r) => r.userId));

    return {
      requests: requests.map((r) => {
        const user = userMap.get(r.userId);
        return {
          ...toPublicJoinRequest(r),
          user: {
            id: r.userId,
            name: user?.name ?? 'Unknown',
            email: user?.email ?? '',
          },
        };
      }),
    };
  },

  async 'teams.approveJoinRequest'({ requestId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(requestId)) throw new Meteor.Error('not-found', 'Invalid request id');

    const request = await TeamJoinRequests.rawCollection().findOne({
      _id: new ObjectId(requestId),
    });
    if (!request) throw new Meteor.Error('not-found', 'Request not found');
    if (request.status !== 'pending') {
      throw new Meteor.Error('already-processed', 'Request already processed');
    }

    const team = await Teams.rawCollection().findOne({ _id: new ObjectId(request.teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }

    await Teams.rawCollection().updateOne(
      { _id: team._id },
      { $addToSet: { members: request.userId }, $set: { updatedAt: new Date() } },
    );

    // Auto-add to org if allowAutoJoin is enabled (consistent with invite flow)
    const db = rawDb();
    const { addOrgMember } = await import('./org-helpers.js');
    const org = team.orgId && isValidId(team.orgId)
      ? await db.collection('organizations').findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await addOrgMember(team.orgId, request.userId, 'member', true);
    }

    await TeamJoinRequests.rawCollection().updateOne(
      { _id: request._id },
      {
        $set: {
          status: 'approved',
          respondedAt: new Date(),
          respondedBy: identity.userId,
          updatedAt: new Date(),
        },
      },
    );

    const admin = await findUserById(identity.userId);
    const adminName = admin?.name ?? 'An admin';

    await createNotification({
      userId: request.userId,
      title: 'Join request approved',
      body: `${adminName} approved your request to join ${team.name}`,
      data: {
        type: 'team-join-request-approved',
        teamId: team._id.toHexString(),
        adminId: identity.userId,
        url: `/app/teams?teamId=${team._id.toHexString()}`,
      },
    });

    return { status: 'ok' };
  },

  async 'teams.declineJoinRequest'({ requestId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(requestId)) throw new Meteor.Error('not-found', 'Invalid request id');

    const request = await TeamJoinRequests.rawCollection().findOne({
      _id: new ObjectId(requestId),
    });
    if (!request) throw new Meteor.Error('not-found', 'Request not found');
    if (request.status !== 'pending') {
      throw new Meteor.Error('already-processed', 'Request already processed');
    }

    const team = await Teams.rawCollection().findOne({ _id: new ObjectId(request.teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');
    if (!team.admins.includes(identity.userId)) {
      throw new Meteor.Error('forbidden', 'Admin access required');
    }

    await TeamJoinRequests.rawCollection().updateOne(
      { _id: request._id },
      {
        $set: {
          status: 'declined',
          respondedAt: new Date(),
          respondedBy: identity.userId,
          updatedAt: new Date(),
        },
      },
    );

    const admin = await findUserById(identity.userId);
    const adminName = admin?.name ?? 'An admin';

    await createNotification({
      userId: request.userId,
      title: 'Join request declined',
      body: `${adminName} declined your request to join ${team.name}`,
      data: {
        type: 'team-join-request-declined',
        teamId: team._id.toHexString(),
        adminId: identity.userId,
        url: '/app/teams',
      },
    });

    return { status: 'ok' };
  },

  async 'teams.getJoinRequestPreview'({ notificationId }) {
    const identity = await requireIdentity(this);
    if (!isValidId(notificationId)) throw new Meteor.Error('not-found', 'Invalid notification id');

    const n = await rawDb().collection('notifications').findOne({
      _id: new ObjectId(notificationId),
    });
    if (!n) throw new Meteor.Error('not-found', 'Notification not found');
    if (n.userId !== identity.userId) throw new Meteor.Error('forbidden', 'Forbidden');

    const data = n.data ?? {};
    if (data.type !== 'team-join-request') {
      throw new Meteor.Error('bad-request', 'Not a team join request');
    }

    const reqId = typeof data.requestId === 'string' ? data.requestId : '';
    if (!reqId || !isValidId(reqId)) throw new Meteor.Error('bad-request', 'Invalid request id');

    const request = await TeamJoinRequests.rawCollection().findOne({ _id: new ObjectId(reqId) });
    if (!request) throw new Meteor.Error('not-found', 'Request not found');

    const team = await Teams.rawCollection().findOne({ _id: new ObjectId(request.teamId) });
    if (!team) throw new Meteor.Error('not-found', 'Team not found');

    const requester = await findUserById(request.userId);

    return {
      notificationId,
      requestId: reqId,
      teamId: request.teamId,
      teamName: team.name,
      teamDescription: team.description ?? '',
      requester: requester
        ? {
            id: requester._id.toHexString(),
            name: requester.name ?? requester.email?.split('@')[0] ?? 'Unknown',
            email: requester.email ?? '',
          }
        : null,
      alreadyProcessed: request.status !== 'pending',
    };
  },

  async 'teams.respondToJoinRequest'({ notificationId, action }) {
    const identity = await requireIdentity(this);
    if (!isValidId(notificationId)) throw new Meteor.Error('not-found', 'Invalid notification id');
    if (action !== 'approve' && action !== 'decline') {
      throw new Meteor.Error('bad-request', 'action must be approve or decline');
    }

    const n = await rawDb().collection('notifications').findOne({
      _id: new ObjectId(notificationId),
    });
    if (!n) throw new Meteor.Error('not-found', 'Notification not found');
    if (n.userId !== identity.userId) throw new Meteor.Error('forbidden', 'Forbidden');

    const data = n.data ?? {};
    if (data.type !== 'team-join-request') {
      throw new Meteor.Error('bad-request', 'Not a team join request');
    }

    const reqId = typeof data.requestId === 'string' ? data.requestId : '';
    if (!reqId || !isValidId(reqId)) throw new Meteor.Error('bad-request', 'Invalid request id');

    if (action === 'approve') {
      await Meteor.callAsync('teams.approveJoinRequest', { requestId: reqId });
    } else {
      await Meteor.callAsync('teams.declineJoinRequest', { requestId: reqId });
    }

    await rawDb().collection('notifications').deleteOne({
      _id: new ObjectId(notificationId),
      userId: identity.userId,
    });

    return { ok: true };
  },
});
