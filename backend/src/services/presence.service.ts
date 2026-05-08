// ─── Presence Service ─────────────────────────────────────────────────────────
//
// Tracks which users are currently online via WebSocket heartbeats.
// A user is considered online as long as their WebSocket is connected.
// After 75 seconds without a heartbeat, they are marked offline.

const TIMEOUT_MS = 75_000;

type PresenceCallback = (userId: string, online: boolean) => void;

const online = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<PresenceCallback>();

function subscribe(fn: PresenceCallback): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function broadcast(userId: string, isOnline: boolean) {
  for (const fn of listeners) fn(userId, isOnline);
}

function markOnline(userId: string): void {
  const existing = online.get(userId);
  if (existing) clearTimeout(existing);

  const wasOnline = online.has(userId);
  const timer = setTimeout(() => {
    online.delete(userId);
    broadcast(userId, false);
  }, TIMEOUT_MS);

  online.set(userId, timer);

  if (!wasOnline) broadcast(userId, true);
}

function markOffline(userId: string): void {
  const existing = online.get(userId);
  if (!existing) return;
  clearTimeout(existing);
  online.delete(userId);
  broadcast(userId, false);
}

function isOnline(userId: string): boolean {
  return online.has(userId);
}

function getOnlineSet(userIds: string[]): Set<string> {
  return new Set(userIds.filter((id) => online.has(id)));
}

export const presenceService = { markOnline, markOffline, isOnline, getOnlineSet, subscribe };
