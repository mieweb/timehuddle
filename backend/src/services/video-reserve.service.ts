/**
 * In-memory one-shot reservation store that links a pulsevault videoid to a
 * ticket before the TUS upload begins.
 *
 * Flow:
 *   1. POST /v1/pulsevault/reserve — client calls this with a ticketId.
 *      Server generates a videoid, stores the mapping here, returns videoid.
 *   2. Client uploads video via TUS using that videoid.
 *   3. onUploadComplete fires — consumeReservation(videoid) returns the stored
 *      { ticketId, userId } and removes the entry so it cannot be replayed.
 */

interface Reservation {
  ticketId: string;
  userId: string;
}

const store = new Map<string, Reservation>();

export function reserveVideo(videoid: string, ticketId: string, userId: string): void {
  store.set(videoid, { ticketId, userId });
}

export function consumeReservation(videoid: string): Reservation | undefined {
  const entry = store.get(videoid);
  store.delete(videoid);
  return entry;
}
