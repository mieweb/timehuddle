import { ObjectId } from "mongodb";

export const ORG_MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;

export type OrgMembershipRole = (typeof ORG_MEMBERSHIP_ROLES)[number];

export interface OrgMembership {
  _id: ObjectId;
  orgId: string;
  userId: string;
  role: OrgMembershipRole;
  auto: boolean;
  createdAt: Date;
  updatedAt?: Date;
}
