/**
 * In-memory one-shot reservation store that links a pulsevault videoid to a
 * ticket before the TUS upload begins.
 *
 * Flow:
 *   1. POST /v1/pulsevault/reserve — client calls this with a ticketId.
 *      Server generates a videoid + one-time upload token, stores the mapping
 *      here, returns both to the client.
 *   2. Client embeds the token in the pulsecam:// deep link.
 *      Pulse Cam forwards it as Authorization: Bearer <token> on every TUS
 *      request — allowing the upload to bypass session auth.
 *   3. onUploadComplete fires — consumeReservation(videoid) returns the stored
 *      { ticketId, userId } and removes the entry so it cannot be replayed.
 */
import { randomUUID } from "node:crypto";

interface Reservation {
  ticketId: string;
  userId: string;
  /** One-time auth token forwarded by Pulse Cam as Authorization: Bearer. */
  token: string;
}

const store = new Map<string, Reservation>();

/** Reserve a videoid for a ticket. Returns the one-time upload token. */
export function reserveVideo(videoid: string, ticketId: string, userId: string): string {
  const token = randomUUID();
  store.set(videoid, { ticketId, userId, token });
  return token;
}

/** Non-destructive check: does a valid reservation + token pair exist? */
export function verifyReservationToken(videoid: string, token: string): boolean {
  const entry = store.get(videoid);
  return entry?.token === token;
}

export function consumeReservation(videoid: string): Omit<Reservation, "token"> | undefined {
  const entry = store.get(videoid);
  store.delete(videoid);
  return entry ? { ticketId: entry.ticketId, userId: entry.userId } : undefined;
}
