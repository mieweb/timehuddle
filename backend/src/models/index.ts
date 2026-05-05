import { getDB } from "../lib/db.js";
import type { User } from "./user.model.js";
import type { Team } from "./team.model.js";
import type { Ticket } from "./ticket.model.js";
import type { ClockEvent } from "./clock.model.js";
import type { Message } from "./message.model.js";
import type { Notification } from "./notification.model.js";
import type { Attachment } from "./attachment.model.js";
import type { Profile } from "./profile.model.js";
import type { EncryptedOpLogBatch } from "./encrypted-oplog.model.js";
import type { RecoveryKeyStatus } from "./recovery-key-status.model.js";
import type { PushSubscription } from "./push-subscription.model.js";
import type { UserDeviceTokens } from "./device-token.model.js";
import type { TimeEntry } from "./time-entry.model.js";
import type { TimerSession } from "./timer-session.model.js";

// Collection accessor — better-auth's MongoDB adapter uses "user" (singular)
export function usersCollection() {
  return getDB().collection<User>("user");
}

// Teams — populated once Phase 3 timehuddle migration is complete
export function teamsCollection() {
  return getDB().collection<Team>("teams");
}

// Tickets
export function ticketsCollection() {
  return getDB().collection<Ticket>("tickets");
}

// Clock events
export function clockEventsCollection() {
  return getDB().collection<ClockEvent>("clockevents");
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

// Encrypted op-log batches
export function encryptedOpLogsCollection() {
  return getDB().collection<EncryptedOpLogBatch>("encryptedOpLogs");
}

// Recovery key save-status
export function recoveryKeyStatusCollection() {
  return getDB().collection<RecoveryKeyStatus>("recoveryKeyStatus");
}

// Push subscriptions
export function pushSubscriptionsCollection() {
  return getDB().collection<PushSubscription>("pushsubscriptions");
}

// Device push tokens (one doc per user, tokens stored as array)
export function deviceTokensCollection() {
  return getDB().collection<UserDeviceTokens>("devicetokens");
}

// Time entries — one row per user × ticket × calendar day
export function timeEntriesCollection() {
  return getDB().collection<TimeEntry>("timeentries");
}

// Timer sessions — the canonical ledger of work segments
export function timerSessionsCollection() {
  return getDB().collection<TimerSession>("timersessions");
}
