import type { ObjectId } from "mongodb";

/** A single registered device push token for a user. */
export interface DeviceTokenEntry {
  token: string;
  platform: "ios" | "android";
  updatedAt: Date;
}

/** One document per user — stores all their device tokens as an array. */
export interface UserDeviceTokens {
  _id: ObjectId;
  userId: string; // unique index
  tokens: DeviceTokenEntry[];
}
