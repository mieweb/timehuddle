import { ObjectId } from "mongodb";

export interface Profile {
  _id: ObjectId;
  userId: string;
  app: "timeharbor";
  displayName: string;
  avatarUrl?: string;
  status: "online" | "offline";
  lastSeenAt?: Date;
  githubUrl?: string;
  linkedinUrl?: string;
  redmineUrl?: string;
  fcmToken?: string;
  fcmPlatform?: "ios" | "android";
  fcmUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
