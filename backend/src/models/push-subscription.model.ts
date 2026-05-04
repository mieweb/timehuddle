import type { ObjectId } from "mongodb";

export interface PushSubscription {
  _id: ObjectId;
  userId: string;
  type: "webpush" | "native";
  // Web push fields
  endpoint?: string;
  keys?: { p256dh: string; auth: string };
  expirationTime?: number | null;
  // Native (FCM/APNs) fields
  token?: string;
  platform?: "ios" | "android";
  createdAt: Date;
  updatedAt: Date;
}
