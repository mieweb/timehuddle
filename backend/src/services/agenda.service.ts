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
import { clockEventsCollection } from "../models/index.js";
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
  // Broadcast-only (not saved to inbox). The user sees a modal to either
  // "Continue Working" (no-op) or "Agree to Clock Out" (schedules auto-clockout).
  _agenda.define("shift-end-reminder", async (job: Job) => {
    const { clockEventId, userId, teamId } = job.attrs.data as ClockJobData;
    const event = await clockEventsCollection().findOne({
      _id: new ObjectId(clockEventId),
      endTime: null,
    });
    if (!event) return; // already clocked out
    if (event.autoClockoutAgreed) return; // already agreed — no need to prompt again
    broadcastToUser(userId, {
      id: `shift-reminder-${clockEventId}`,
      userId,
      title: "TiméHuddle",
      body: "You are approaching 8 hours. Would you like to continue working or clock out?",
      data: { type: "shift-end-reminder", clockEventId, teamId, url: "/app/clock" },
      read: false,
      createdAt: new Date().toISOString(),
    });
  });

  // ── Job: 8h auto-clockout ─────────────────────────────────────────────────
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

  await _agenda.start();
  console.log(
    "[agenda] started — jobs: shift-4h-reminder, shift-end-reminder, shift-auto-clockout"
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

/** Cancel all pending Agenda jobs for a clock event (manual clock-out or delete). */
export async function cancelClockJobs(clockEventId: string): Promise<void> {
  await _agenda.cancel({ data: { clockEventId } });
}
