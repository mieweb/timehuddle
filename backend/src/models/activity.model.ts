import type { ObjectId } from "mongodb";

// ─── Payload types (one per activity type) ───────────────────────────────────

export interface ClockInPayload {
  teamId: string;
  teamName?: string;
}

export interface ClockOutPayload {
  teamId: string;
  teamName?: string;
  durationSeconds?: number;
}

export interface TicketCreatedPayload {
  ticketId: string;
  ticketTitle: string;
  teamId: string;
}

export interface TicketUpdatedPayload {
  ticketId: string;
  ticketTitle: string;
  teamId: string;
  action:
    | "edited"
    | "status-changed"
    | "priority-changed"
    | "status-priority-changed"
    | "assigned"
    | "unassigned"
    | "deleted"
    | "batch-status-changed";
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  assigneeName?: string;
}

// ─── Activity type constants ──────────────────────────────────────────────────

export const ActivityType = {
  ClockIn: "clock.in",
  ClockOut: "clock.out",
  TicketCreated: "ticket.created",
  TicketUpdated: "ticket.updated",
} as const;

// ─── Discriminated union ──────────────────────────────────────────────────────

interface ActivityBase {
  _id: ObjectId;
  userId: string;
  teamId?: string;
  actor: { id: string; name: string; avatar?: string };
  occurredAt: Date;
  source: "timehuddle" | "activitywatch" | "external";
}

export interface ClockInActivity extends ActivityBase {
  type: "clock.in";
  payload: ClockInPayload;
}

export interface ClockOutActivity extends ActivityBase {
  type: "clock.out";
  payload: ClockOutPayload;
}

export interface TicketCreatedActivity extends ActivityBase {
  type: "ticket.created";
  payload: TicketCreatedPayload;
}

export interface TicketUpdatedActivity extends ActivityBase {
  type: "ticket.updated";
  payload: TicketUpdatedPayload;
}

/** Extensible discriminated union — add new variants here as features grow. */
export type ActivityEvent =
  | ClockInActivity
  | ClockOutActivity
  | TicketCreatedActivity
  | TicketUpdatedActivity;

// ─── Emit input type ──────────────────────────────────────────────────────────

type WithDefaults = { occurredAt?: Date; source?: ActivityBase["source"] };

export type EmitActivityInput =
  | (Omit<ClockInActivity, "_id" | "occurredAt" | "source"> & WithDefaults)
  | (Omit<ClockOutActivity, "_id" | "occurredAt" | "source"> & WithDefaults)
  | (Omit<TicketCreatedActivity, "_id" | "occurredAt" | "source"> & WithDefaults)
  | (Omit<TicketUpdatedActivity, "_id" | "occurredAt" | "source"> & WithDefaults);

// ─── Public (API-facing) shape ────────────────────────────────────────────────

export interface PublicActivityEvent {
  id: string;
  userId: string;
  teamId?: string;
  type: string;
  actor: { id: string; name: string; avatar?: string };
  payload: Record<string, unknown>;
  occurredAt: string; // ISO 8601
  source: string;
}
