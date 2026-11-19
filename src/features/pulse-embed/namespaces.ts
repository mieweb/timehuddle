/**
 * Stale Pulse namespaces (PLAN §6.4): each account that signed in on this
 * phone has its own Pulse namespace. At each sign-in Huddle lists them and
 * purges TimeHuddle's own that have no unsent videos and haven't been used
 * for 30 days. A namespace with unsent videos stays until its account signs
 * in again (and sends or deletes them); the active one, and other apps'
 * namespaces, are never touched.
 */
import type { NamespaceInfo } from '@mieweb/pulse-embed';

/** The host id TimeHuddle configures Pulse with: its namespaces' prefix. */
export const PULSE_HOST_ID = 'com.mieweb.timehuddle';

/** How long a namespace with nothing unsent stays after its last use. */
export const STALE_NAMESPACE_MS = 30 * 24 * 60 * 60 * 1000;

/** The namespaces to purge, from `listNamespaces()`. */
export function staleNamespaces(
  namespaces: readonly NamespaceInfo[],
  now: number,
  hostId: string = PULSE_HOST_ID,
  maxIdleMs: number = STALE_NAMESPACE_MS,
): string[] {
  return namespaces
    .filter(
      (ns) =>
        ns.hostId === hostId &&
        !ns.active &&
        ns.unsent === 0 &&
        Number.isFinite(ns.lastUsedAt) &&
        now - ns.lastUsedAt >= maxIdleMs,
    )
    .map((ns) => ns.namespace);
}
