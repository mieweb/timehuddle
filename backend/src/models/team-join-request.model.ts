import { ObjectId } from "mongodb";

export interface TeamJoinRequest {
  _id: ObjectId;
  teamId: string; // Team ObjectId as hex string
  userId: string; // User ObjectId as hex string
  teamCode: string; // Original team code used to join
  status: "pending" | "approved" | "declined" | "expired";
  requestedAt: Date;
  respondedAt?: Date;
  respondedBy?: string; // Admin userId who approved/declined
  createdAt: Date;
  updatedAt?: Date;
}

export interface PublicTeamJoinRequest {
  id: string;
  teamId: string;
  userId: string;
  teamCode: string;
  status: "pending" | "approved" | "declined" | "expired";
  requestedAt: string; // ISO string
  respondedAt?: string;
  respondedBy?: string;
}

export function toPublicTeamJoinRequest(doc: TeamJoinRequest): PublicTeamJoinRequest {
  return {
    id: doc._id.toHexString(),
    teamId: doc.teamId,
    userId: doc.userId,
    teamCode: doc.teamCode,
    status: doc.status,
    requestedAt: doc.requestedAt.toISOString(),
    respondedAt: doc.respondedAt?.toISOString(),
    respondedBy: doc.respondedBy,
  };
}
