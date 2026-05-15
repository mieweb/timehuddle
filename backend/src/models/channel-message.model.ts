import { ObjectId } from "mongodb";

export interface ChannelMessage {
  _id: ObjectId;
  channelId: string;
  teamId: string;
  fromUserId: string;
  senderName: string;
  text: string;
  createdAt: Date;
}

export interface PublicChannelMessage {
  id: string;
  channelId: string;
  teamId: string;
  fromUserId: string;
  senderName: string;
  text: string;
  createdAt: string; // ISO
}
