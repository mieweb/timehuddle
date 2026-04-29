import { getDB } from "../lib/db.js";
import type { User } from "./user.model.js";
import type { Team } from "./team.model.js";
import type { Ticket } from "./ticket.model.js";
import type { ClockEvent } from "./clock.model.js";
import type { Message } from "./message.model.js";
import type { Notification } from "./notification.model.js";

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
