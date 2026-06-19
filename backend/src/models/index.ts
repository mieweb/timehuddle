import { getDB } from "../lib/db.js";
import type { User } from "./user.model.js";
import type { Team } from "./team.model.js";
import type { Ticket } from "./ticket.model.js";
import type { ClockBreak, ClockEvent } from "./clock.model.js";
import type { Message } from "./message.model.js";
import type { Notification } from "./notification.model.js";
import type { Attachment } from "./attachment.model.js";
import type { Profile } from "./profile.model.js";
import type { PushSubscription } from "./push-subscription.model.js";
import type { UserDeviceTokens } from "./device-token.model.js";
import type { WorkItem } from "./work-item.model.js";
import type { Timer } from "./timer.model.js";
import type { ActivityEvent } from "./activity.model.js";
import type { Channel } from "./channel.model.js";
import type { ChannelMessage } from "./channel-message.model.js";
import type { PersonalAccessToken } from "./personal-access-token.model.js";
import type { Organization } from "./organization.model.js";
import type { MediaItem } from "./media-item.model.js";
import type { Enterprise } from "./enterprise.model.js";
import type { OrgMembership } from "./org-membership.model.js";
import type { Installation } from "./installation.model.js";
import type { HuddlePost } from "./huddle-post.model.js";
import type { HuddleComment } from "./huddle-comment.model.js";

// Collection accessor — better-auth's MongoDB adapter uses "user" (singular)
export function usersCollection() {
  return getDB().collection<User>("user");
}

// Teams — populated once Phase 3 timehuddle migration is complete
export function teamsCollection() {
  return getDB().collection<Team>("teams");
}

// Organizations
export function organizationsCollection() {
  return getDB().collection<Organization>("organizations");
}

// Enterprises
export function enterprisesCollection() {
  return getDB().collection<Enterprise>("enterprises");
}

// Installation lifecycle state
export function installationsCollection() {
  return getDB().collection<Installation>("app_settings");
}

// Organization memberships
export function orgMembersCollection() {
  return getDB().collection<OrgMembership>("org_members");
}

// Tickets
export function ticketsCollection() {
  return getDB().collection<Ticket>("tickets");
}

// Clock events
export function clockEventsCollection() {
  return getDB().collection<ClockEvent>("clockevents");
}

// Clock breaks — separate collection, each document references a clockevents._id
export function clockBreaksCollection() {
  return getDB().collection<ClockBreak>("clockbreaks");
}

// Messages
export function messagesCollection() {
  return getDB().collection<Message>("messages");
}

// Notifications
export function notificationsCollection() {
  return getDB().collection<Notification>("notifications");
}

// Attachments
export function attachmentsCollection() {
  return getDB().collection<Attachment>("attachments");
}

// Profiles
export function profilesCollection() {
  return getDB().collection<Profile>("profiles");
}

// Push subscriptions
export function pushSubscriptionsCollection() {
  return getDB().collection<PushSubscription>("pushsubscriptions");
}

// Device push tokens (one doc per user, tokens stored as array)
export function deviceTokensCollection() {
  return getDB().collection<UserDeviceTokens>("devicetokens");
}

// Work items — one row per user × ticket × calendar day
export function workItemsCollection() {
  return getDB().collection<WorkItem>("workitems");
}

// Timers — the canonical ledger of work segments
export function timersCollection() {
  return getDB().collection<Timer>("timers");
}

// Activity log
export function activitiesCollection() {
  return getDB().collection<ActivityEvent>("activities");
}

// Channels — team-scoped group chat
export function channelsCollection() {
  return getDB().collection<Channel>("channels");
}

// Channel messages
export function channelMessagesCollection() {
  return getDB().collection<ChannelMessage>("channelmessages");
}

// Personal access tokens
export function personalAccessTokensCollection() {
  return getDB().collection<PersonalAccessToken>("personal_access_tokens");
}

// Media library items
export function mediaItemsCollection() {
  return getDB().collection<MediaItem>("mediaitems");
}

// Huddle posts — team feed
export function huddlePostsCollection() {
  return getDB().collection<HuddlePost>("huddleposts");
}

// Huddle comments — comments on huddle posts
export function huddleCommentsCollection() {
  return getDB().collection<HuddleComment>("huddlecomments");
}
