/**
 * Agenda — MongoDB-backed job scheduler for time-sensitive clock events.
 *
 * Jobs are persisted in the `agendajobs` collection, so they survive server
 * restarts and are picked up exactly once even during rolling deployments.
 *
 * Three job types:
 *   shift-4h-reminder     — fires at startTime + 4h   → "Take a break"
 *   shift-end-reminder    — fires at startTime + 7h45m → shift-end modal
 *   shift-auto-clockout   — fires at startTime + 8h    → auto-clockout
 *                           (only scheduled when user clicks "Agree to Clock Out")
 */
import { Agenda, type Job } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";
import { ObjectId } from "mongodb";
import { clockEventsCollection, notificationsCollection } from "../models/index.js";
import { notificationService, broadcastToUser } from "./notification.service.js";

interface ClockJobData {
  clockEventId: string;
  userId: string;
  teamId: string;
}

const FOUR_HOURS_MS = 4 * 3600_000;
const SHIFT_END_MS = 27_900_000; // 7h 45m
const AUTO_CLOCKOUT_MS = 8 * 3600_000;

let _agenda: Agenda;

export function getAgenda(): Agenda {
  return _agenda;
}

export async function initAgenda(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is not set");

  _agenda = new Agenda({
    backend: new MongoBackend({ address: mongoUri, collection: "agendajobs" }),
    processEvery: "30 seconds",
    defaultLockLifetime: 10_000,
  });

  // ── Job: 4h "Take a Break" reminder ──────────────────────────────────────
  _agenda.define("shift-4h-reminder", async (job: Job) => {
    const { clockEventId, userId, teamId } = job.attrs.data as ClockJobData;
    const event = await clockEventsCollection().findOne({
      _id: new ObjectId(clockEventId),
      endTime: null,
    });
    if (!event) return; // already clocked out — nothing to do
    await notificationService.create({
      userId,
      title: "TiméHuddle",
      body: "Take a break. You have worked for 4 hours.",
      notificationData: {
        type: "break-reminder-4h",
        teamId,
        clockEventId,
        url: "/app/clock",
      },
    });
  });

  // ── Job: 7h45m shift-end reminder ────────────────────────────────────────
  // Broadcasts via SSE (for connected users) AND persists to notification inbox
  // (so offline users see the modal when they return). Also schedules a
  // shift-missed-clockout job at 8h to auto-clockout users who never respond.
  _agenda.define("shift-end-reminder", async (job: Job) => {
    const { clockEventId, userId, teamId } = job.attrs.data as ClockJobData;
    const event = await clockEventsCollection().findOne({
      _id: new ObjectId(clockEventId),
      endTime: null,
    });
    if (!event) return; // already clocked out
    if (event.autoClockoutAgreed) return; // already agreed — no need to prompt again

    const body = "You are approaching 8 hours. Would you like to continue working or clock out?";

    // Persist to inbox so offline users see it on return
    const persisted = await notificationService.create({
      userId,
      title: "TiméHuddle",
      body,
      notificationData: { type: "shift-end-reminder", clockEventId, teamId, url: "/app/clock" },
    });

    // Also broadcast directly for connected clients (gives them the modal immediately
    // rather than waiting for the next notification poll).
    broadcastToUser(userId, {
      id: persisted.id,
      userId,
      title: "TiméHuddle",
      body,
      data: { type: "shift-end-reminder", clockEventId, teamId, url: "/app/clock" },
      read: false,
      createdAt: persisted.createdAt,
    });

    // Schedule missed-clockout at 8h — fires if the user never responds
    await scheduleMissedClockout(clockEventId, userId, teamId, event.startTime);
  });

  // ── Job: 8h auto-clockout (agreed) ───────────────────────────────────────
  // Only runs if the user clicked "Agree to Clock Out" (autoClockoutAgreed=true).
  // Dynamic import of clockService breaks the circular dependency.
  _agenda.define("shift-auto-clockout", async (job: Job) => {
    const { clockEventId, userId, teamId } = job.attrs.data as ClockJobData;
    const event = await clockEventsCollection().findOne({
      _id: new ObjectId(clockEventId),
      endTime: null,
    });
    if (!event) return; // already clocked out
    if (!event.autoClockoutAgreed) return; // user changed their mind
    const { clockService } = await import("./clock.service.js");
    await clockService.stop(userId, teamId);
  });

  // ── Job: 8h missed auto-clockout ─────────────────────────────────────────
  // Fires at startTime + 8h for users who never responded to the shift-end
  // reminder (i.e., were offline / ignored it). Does NOT fire if the user
  // explicitly clicked "Continue Working" (shiftReminderResponse === "disagreed").
  _agenda.define("shift-missed-clockout", async (job: Job) => {
    const { clockEventId, userId, teamId } = job.attrs.data as ClockJobData;
    const event = await clockEventsCollection().findOne({
      _id: new ObjectId(clockEventId),
      endTime: null,
    });
    if (!event) return; // already clocked out
    // Respect the user's explicit "Continue Working" choice
    if (event.shiftReminderResponse === "disagreed") return;
    // The agreed path is handled by shift-auto-clockout; avoid double-clocking
    if (event.autoClockoutAgreed) return;

    const { clockService } = await import("./clock.service.js");
    await clockService.stop(userId, teamId);

    // Update the existing shift-end-reminder notification in-place: change its
    // title/body to describe the auto-clock-out outcome and mark it as read.
    // This keeps exactly one notification in the inbox instead of creating a
    // separate "auto-clock-out" entry alongside the original reminder.
    await notificationsCollection().updateOne(
      { userId, "data.clockEventId": clockEventId, "data.type": "shift-end-reminder" },
      {
        $set: {
          read: true,
          title: "TiméHuddle — Auto Clock-Out",
          body: "You were automatically clocked out after 8 hours because the shift-end reminder was not acknowledged.",
          "data.type": "auto-clock-out",
        },
      }
    );
  });

  await _agenda.start();
  console.log(
    "[agenda] started — jobs: shift-4h-reminder, shift-end-reminder, shift-auto-clockout, shift-missed-clockout"
  );
}

export async function stopAgenda(): Promise<void> {
  await _agenda?.stop();
  console.log("[agenda] stopped");
}

// ── Scheduling helpers ────────────────────────────────────────────────────────

/**
 * Schedule the 4h break reminder and 7h45m shift-end reminder for a new clock
 * session. Jobs that are already in the past are skipped (e.g. time-edited sessions).
 */
export async function scheduleClockJobs(
  clockEventId: string,
  userId: string,
  teamId: string,
  startTimeMs: number
): Promise<void> {
  const data: ClockJobData = { clockEventId, userId, teamId };
  const now = Date.now();

  const fourHourAt = new Date(startTimeMs + FOUR_HOURS_MS);
  const shiftEndAt = new Date(startTimeMs + SHIFT_END_MS);

  if (fourHourAt.getTime() > now) {
    await _agenda
      .create("shift-4h-reminder", data)
      .unique({ "data.clockEventId": clockEventId, name: "shift-4h-reminder" })
      .schedule(fourHourAt)
      .save();
  }

  if (shiftEndAt.getTime() > now) {
    await _agenda
      .create("shift-end-reminder", data)
      .unique({ "data.clockEventId": clockEventId, name: "shift-end-reminder" })
      .schedule(shiftEndAt)
      .save();
  }
}

/**
 * Re-schedule jobs after an admin edits a session's startTime.
 * Cancels all existing jobs for the event then re-evaluates which are still in
 * the future.
 */
export async function rescheduleClockJobs(
  clockEventId: string,
  userId: string,
  teamId: string,
  newStartTimeMs: number,
  autoClockoutAgreed: boolean
): Promise<void> {
  await cancelClockJobs(clockEventId);
  await scheduleClockJobs(clockEventId, userId, teamId, newStartTimeMs);
  if (autoClockoutAgreed) {
    await scheduleAutoClockout(clockEventId, userId, teamId, newStartTimeMs);
  }
}

/**
 * Schedule the 8h auto-clockout job. Called when the user clicks
 * "Agree to Clock Out" on the shift-end reminder modal.
 */
export async function scheduleAutoClockout(
  clockEventId: string,
  userId: string,
  teamId: string,
  startTimeMs: number
): Promise<void> {
  const data: ClockJobData = { clockEventId, userId, teamId };
  const autoClockoutAt = new Date(startTimeMs + AUTO_CLOCKOUT_MS);
  // If already past 8h, fire in 5s (e.g. user agreed very late or seeded data)
  const fireAt =
    autoClockoutAt.getTime() > Date.now() ? autoClockoutAt : new Date(Date.now() + 5_000);

  await _agenda
    .create("shift-auto-clockout", data)
    .unique({ "data.clockEventId": clockEventId, name: "shift-auto-clockout" })
    .schedule(fireAt)
    .save();
}

/**
 * Schedule the 8h missed-clockout job. Called from the shift-end-reminder job
 * handler to auto-clockout users who never respond (were offline / ignored the
 * modal). Cancelled when user agrees or disagrees.
 */
export async function scheduleMissedClockout(
  clockEventId: string,
  userId: string,
  teamId: string,
  startTimeMs: number
): Promise<void> {
  const data: ClockJobData = { clockEventId, userId, teamId };
  const missedAt = new Date(startTimeMs + AUTO_CLOCKOUT_MS);
  // If already past 8h, fire in 30s to give the user a brief moment to respond
  const fireAt = missedAt.getTime() > Date.now() ? missedAt : new Date(Date.now() + 30_000);

  await _agenda
    .create("shift-missed-clockout", data)
    .unique({ "data.clockEventId": clockEventId, name: "shift-missed-clockout" })
    .schedule(fireAt)
    .save();
}

/** Cancel all pending Agenda jobs for a clock event (manual clock-out or delete). */
export async function cancelClockJobs(clockEventId: string): Promise<void> {
  await _agenda.cancel({ data: { clockEventId } });
}

/** Cancel a single named Agenda job for a clock event. */
export async function cancelClockJobsByName(clockEventId: string, name: string): Promise<void> {
  await _agenda.cancel({ name, data: { clockEventId } });
}
