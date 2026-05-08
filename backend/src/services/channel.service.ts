import { ObjectId } from "mongodb";
import {
  channelsCollection,
  channelMessagesCollection,
  teamsCollection,
  usersCollection,
} from "../models/index.js";
import type { Channel, PublicChannel } from "../models/channel.model.js";
import type { ChannelMessage, PublicChannelMessage } from "../models/channel-message.model.js";

// ─── In-memory pub/sub ────────────────────────────────────────────────────────

type ChannelCallback = (msg: PublicChannelMessage) => void;
const channelListeners = new Map<string, Set<ChannelCallback>>();

export function subscribeChannel(channelId: string, fn: ChannelCallback): () => void {
  if (!channelListeners.has(channelId)) channelListeners.set(channelId, new Set());
  channelListeners.get(channelId)!.add(fn);
  return () => {
    channelListeners.get(channelId)?.delete(fn);
    if (channelListeners.get(channelId)?.size === 0) channelListeners.delete(channelId);
  };
}

function broadcast(channelId: string, msg: PublicChannelMessage) {
  channelListeners.get(channelId)?.forEach((fn) => fn(msg));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPublicChannel(c: Channel & { _id: ObjectId }): PublicChannel {
  return {
    id: c._id.toHexString(),
    teamId: c.teamId,
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    isDefault: c.isDefault,
    members: c.members ?? [],
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
  };
}

function toPublicChannelMessage(m: ChannelMessage & { _id: ObjectId }): PublicChannelMessage {
  return {
    id: m._id.toHexString(),
    channelId: m.channelId,
    teamId: m.teamId,
    fromUserId: m.fromUserId,
    senderName: m.senderName,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

class ChannelService {
  /** Upsert the default #general channel for a team. Called after team creation. */
  async ensureDefaultChannel(teamId: string, createdBy: string): Promise<void> {
    const existing = await channelsCollection().findOne({ teamId, isDefault: true });
    if (existing) return;
    const doc: Channel & { _id: ObjectId } = {
      _id: new ObjectId(),
      teamId,
      name: "general",
      description: "General team discussion",
      isDefault: true,
      createdBy,
      createdAt: new Date(),
    };
    await channelsCollection().insertOne(doc);
  }

  /** List all channels the user can see for a team. */
  async getChannels(
    teamId: string,
    userId: string
  ): Promise<PublicChannel[] | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "forbidden";
    const allTeamMembers = [...team.members, ...team.admins];
    if (!allTeamMembers.includes(userId)) return "forbidden";

    let allChannels = await channelsCollection()
      .find({ teamId })
      .sort({ isDefault: -1, createdAt: 1 })
      .toArray();

    // Auto-provision #general for existing teams that pre-date channel support
    if (allChannels.length === 0) {
      await this.ensureDefaultChannel(teamId, userId);
      allChannels = await channelsCollection()
        .find({ teamId })
        .sort({ isDefault: -1, createdAt: 1 })
        .toArray();
    }

    // Filter: user can see team-wide channels (no members list) or channels they're in
    const visible = allChannels.filter(
      (ch) => !ch.members || ch.members.length === 0 || ch.members.includes(userId)
    );

    return visible.map(toPublicChannel);
  }

  /** Create a new channel. Any team member can create. */
  async createChannel(
    teamId: string,
    creatorId: string,
    name: string,
    description?: string,
    members?: string[]
  ): Promise<PublicChannel | "forbidden" | "not-found" | "duplicate"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    const allTeamMembers = [...team.members, ...team.admins];
    if (!allTeamMembers.includes(creatorId)) return "forbidden";

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 50);
    const existing = await channelsCollection().findOne({ teamId, name: cleanName });
    if (existing) return "duplicate";

    // Validate specified members are in the team; always include creator
    let channelMembers: string[] | undefined;
    if (members && members.length > 0) {
      const validIds = members.filter((id) => allTeamMembers.includes(id));
      if (!validIds.includes(creatorId)) validIds.push(creatorId);
      channelMembers = validIds;
    }

    const doc: Channel & { _id: ObjectId } = {
      _id: new ObjectId(),
      teamId,
      name: cleanName,
      ...(description?.trim() ? { description: description.trim() } : {}),
      isDefault: false,
      ...(channelMembers ? { members: channelMembers } : {}),
      createdBy: creatorId,
      createdAt: new Date(),
    };
    await channelsCollection().insertOne(doc);
    return toPublicChannel(doc);
  }

  /** Fetch paginated messages for a channel. */
  async getMessages(
    channelId: string,
    teamId: string,
    userId: string,
    options: { before?: Date; limit?: number } = {}
  ): Promise<{ messages: PublicChannelMessage[]; hasMore: boolean } | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "forbidden";
    const allTeamMembers = [...team.members, ...team.admins];
    if (!allTeamMembers.includes(userId)) return "forbidden";

    const channel = await channelsCollection().findOne({
      _id: new ObjectId(channelId),
      teamId,
    });
    if (!channel) return "forbidden";

    // Check channel-level membership (if restricted)
    if (channel.members && channel.members.length > 0 && !channel.members.includes(userId)) {
      return "forbidden";
    }

    const limit = options.limit ?? 50;
    const filter: Record<string, unknown> = { channelId };
    if (options.before) filter.createdAt = { $lt: options.before };

    const messages = await channelMessagesCollection()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();
    messages.reverse();
    return { messages: messages.map(toPublicChannelMessage), hasMore };
  }

  /** Send a message to a channel. */
  async sendMessage(
    channelId: string,
    teamId: string,
    senderId: string,
    text: string
  ): Promise<PublicChannelMessage | "forbidden" | "not-found"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    const allTeamMembers = [...team.members, ...team.admins];
    if (!allTeamMembers.includes(senderId)) return "forbidden";

    const channel = await channelsCollection().findOne({
      _id: new ObjectId(channelId),
      teamId,
    });
    if (!channel) return "not-found";

    // Check channel-level membership (if restricted)
    if (channel.members && channel.members.length > 0 && !channel.members.includes(senderId)) {
      return "forbidden";
    }

    const sender = await usersCollection().findOne({ _id: new ObjectId(senderId) });
    const senderName = sender?.name ?? sender?.email?.split("@")[0] ?? "Unknown";

    const doc: ChannelMessage & { _id: ObjectId } = {
      _id: new ObjectId(),
      channelId,
      teamId,
      fromUserId: senderId,
      senderName,
      text,
      createdAt: new Date(),
    };
    await channelMessagesCollection().insertOne(doc);
    const pub = toPublicChannelMessage(doc);
    broadcast(channelId, pub);
    return pub;
  }
}

export const channelService = new ChannelService();
