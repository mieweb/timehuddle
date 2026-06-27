import { ObjectId } from "mongodb";
import { teamJoinRequestsCollection, teamsCollection, usersCollection } from "../models/index.js";
import { toId } from "../lib/toId.js";
import type { TeamJoinRequest, PublicTeamJoinRequest } from "../models/team-join-request.model.js";
import { toPublicTeamJoinRequest } from "../models/team-join-request.model.js";
import { notificationService } from "./notification.service.js";
import { broadcastToTeamMembers, broadcastPendingRequests } from "./team.service.js";

interface TeamJoinRequestWithUser extends PublicTeamJoinRequest {
  user: {
    id: string;
    name: string;
    email: string;
  };
}

class TeamJoinRequestService {
  /**
   * Create a new team join request and notify all team admins.
   */
  async create(userId: string, teamId: string, teamCode: string): Promise<PublicTeamJoinRequest> {
    // Check if there's already a pending request
    const existing = await teamJoinRequestsCollection().findOne({
      teamId,
      userId,
      status: "pending",
    });
    if (existing) {
      return toPublicTeamJoinRequest(existing);
    }

    const doc: TeamJoinRequest = {
      _id: new ObjectId(),
      teamId,
      userId,
      teamCode,
      status: "pending",
      requestedAt: new Date(),
      createdAt: new Date(),
    };
    await teamJoinRequestsCollection().insertOne(doc);

    // Notify all team admins
    await this.notifyAdmins(teamId, userId, doc._id.toHexString());

    // Broadcast pending requests update to admins
    await this.broadcastPendingRequestsToAdmins(teamId);

    return toPublicTeamJoinRequest(doc);
  }

  /**
   * Approve a join request - adds user to team.members and updates request status.
   */
  async approve(
    requestId: string,
    adminId: string
  ): Promise<"ok" | "not-found" | "forbidden" | "already-processed"> {
    const request = await teamJoinRequestsCollection().findOne({
      _id: new ObjectId(requestId),
    });
    if (!request) return "not-found";

    // Check if already processed
    if (request.status !== "pending") return "already-processed";

    // Verify admin permission
    const team = await teamsCollection().findOne({ _id: new ObjectId(request.teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";

    // Add user to team members
    await teamsCollection().updateOne(
      { _id: team._id },
      { $addToSet: { members: request.userId }, $set: { updatedAt: new Date() } }
    );

    // Update request status
    await teamJoinRequestsCollection().updateOne(
      { _id: request._id },
      {
        $set: {
          status: "approved",
          respondedAt: new Date(),
          respondedBy: adminId,
          updatedAt: new Date(),
        },
      }
    );

    // Broadcast team update to all members
    const updatedTeam = await teamsCollection().findOne({ _id: team._id });
    if (updatedTeam) {
      broadcastToTeamMembers(updatedTeam, "update");
    }

    // Notify the requester that they were approved
    await this.notifyRequesterApproved(request.userId, request.teamId, adminId);

    // Broadcast pending requests update to admins (request is now gone from pending)
    await this.broadcastPendingRequestsToAdmins(request.teamId);

    return "ok";
  }

  /**
   * Decline a join request - updates request status to declined.
   */
  async decline(
    requestId: string,
    adminId: string
  ): Promise<"ok" | "not-found" | "forbidden" | "already-processed"> {
    const request = await teamJoinRequestsCollection().findOne({
      _id: new ObjectId(requestId),
    });
    if (!request) return "not-found";

    // Check if already processed
    if (request.status !== "pending") return "already-processed";

    // Verify admin permission
    const team = await teamsCollection().findOne({ _id: new ObjectId(request.teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";

    // Update request status
    await teamJoinRequestsCollection().updateOne(
      { _id: request._id },
      {
        $set: {
          status: "declined",
          respondedAt: new Date(),
          respondedBy: adminId,
          updatedAt: new Date(),
        },
      }
    );

    // Notify the requester that they were declined
    await this.notifyRequesterDeclined(request.userId, request.teamId, adminId);

    // Broadcast pending requests update to admins (request is now gone from pending)
    await this.broadcastPendingRequestsToAdmins(request.teamId);

    return "ok";
  }

  /**
   * Get all pending join requests for a team (admin only).
   */
  async getPendingForTeam(
    teamId: string,
    adminId: string
  ): Promise<TeamJoinRequestWithUser[] | "not-found" | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";

    const requests = await teamJoinRequestsCollection()
      .find({ teamId, status: "pending" })
      .sort({ requestedAt: -1 })
      .toArray();

    // Resolve user details
    const userIds = requests.map((r) => toId(r.userId));
    const users = await usersCollection()
      .find({ _id: { $in: userIds as any } })
      .toArray();
    const userMap = new Map(users.map((u) => [u._id.toHexString(), u]));

    return requests.map((r) => {
      const user = userMap.get(r.userId);
      return {
        ...toPublicTeamJoinRequest(r),
        user: {
          id: r.userId,
          name: user?.name ?? "Unknown",
          email: user?.email ?? "",
        },
      };
    });
  }

  /**
   * Get all pending join requests for a user.
   */
  async getPendingForUser(userId: string): Promise<PublicTeamJoinRequest[]> {
    const requests = await teamJoinRequestsCollection()
      .find({ userId, status: "pending" })
      .sort({ requestedAt: -1 })
      .toArray();
    return requests.map(toPublicTeamJoinRequest);
  }

  /**
   * Get a single join request by ID.
   */
  async getById(requestId: string): Promise<TeamJoinRequest | null> {
    return teamJoinRequestsCollection().findOne({ _id: new ObjectId(requestId) });
  }

  /**
   * Broadcast pending requests to all team admins via WebSocket.
   */
  private async broadcastPendingRequestsToAdmins(teamId: string): Promise<void> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return;

    // Get all pending requests for this team
    const requests = await teamJoinRequestsCollection()
      .find({ teamId, status: "pending" })
      .sort({ requestedAt: -1 })
      .toArray();

    const publicRequests = requests.map(toPublicTeamJoinRequest);

    // Broadcast to each admin
    for (const adminId of team.admins) {
      broadcastPendingRequests(adminId, publicRequests);
    }
  }

  /**
   * Send notifications to all team admins about a new join request.
   */
  private async notifyAdmins(
    teamId: string,
    requesterId: string,
    requestId: string
  ): Promise<void> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return;

    const requester = await usersCollection().findOne({ _id: new ObjectId(requesterId) });
    const requesterName = requester?.name ?? "Someone";

    // Send notification to each admin
    for (const adminId of team.admins) {
      await notificationService.create({
        userId: adminId,
        title: "New team join request",
        body: `${requesterName} wants to join ${team.name}`,
        notificationData: {
          type: "team-join-request",
          teamId: team._id.toHexString(),
          requesterId,
          requestId,
          url: `/app/teams?tab=pending&teamId=${team._id.toHexString()}`,
        },
      });
    }
  }

  /**
   * Notify the requester that their join request was approved.
   */
  private async notifyRequesterApproved(
    requesterId: string,
    teamId: string,
    adminId: string
  ): Promise<void> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return;

    const admin = await usersCollection().findOne({ _id: new ObjectId(adminId) });
    const adminName = admin?.name ?? "An admin";

    await notificationService.create({
      userId: requesterId,
      title: "Join request approved",
      body: `${adminName} approved your request to join ${team.name}`,
      notificationData: {
        type: "team-join-request-approved",
        teamId: team._id.toHexString(),
        adminId,
        url: `/app/teams?teamId=${team._id.toHexString()}`,
      },
    });
  }

  /**
   * Notify the requester that their join request was declined.
   */
  private async notifyRequesterDeclined(
    requesterId: string,
    teamId: string,
    adminId: string
  ): Promise<void> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return;

    const admin = await usersCollection().findOne({ _id: new ObjectId(adminId) });
    const adminName = admin?.name ?? "An admin";

    await notificationService.create({
      userId: requesterId,
      title: "Join request declined",
      body: `${adminName} declined your request to join ${team.name}`,
      notificationData: {
        type: "team-join-request-declined",
        teamId: team._id.toHexString(),
        adminId,
        url: `/app/teams`,
      },
    });
  }
}

export const teamJoinRequestService = new TeamJoinRequestService();
