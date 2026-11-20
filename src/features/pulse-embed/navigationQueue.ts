/**
 * Navigation while Pulse is open (PLAN §5.3). Pulse covers the whole screen,
 * so a notification tap or a `timehuddle://` link that arrives meanwhile is
 * held ("Opens when you finish") and applied once the flow ends, with the
 * person back on Huddle. Only a sign-out or an expired session closes Pulse
 * from Huddle's side (`close({reason: 'host'})`); the take is kept.
 */
import type { PulseClient } from '@mieweb/pulse-embed';

export type Navigate = (path: string) => void;

export interface NavigationQueue {
  /** Pulse has a flow on screen (the provider sets it on open, and clears it on the result). */
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /**
   * Go to `path` now, or, while Pulse is open, hold it until the flow ends.
   * A later request replaces a held one: the person ends up where they
   * tapped last.
   */
  request(path: string, navigate: Navigate): 'now' | 'queued';
  /** The flow ended: Pulse is closed, and the held navigation (if any) runs. */
  flowEnded(): string | null;
  /** The held path, if any. */
  pending(): string | null;
  /** Drop the held navigation (signed out: it was for the old session). */
  clear(): void;
}

export interface NavigationQueueOptions {
  /** Told when a navigation is held, to say "Opens when you finish". */
  onQueued?: (path: string) => void;
}

export function createNavigationQueue(options: NavigationQueueOptions = {}): NavigationQueue {
  let open = false;
  let held: { path: string; navigate: Navigate } | null = null;

  return {
    setOpen(next) {
      open = next;
    },
    isOpen: () => open,
    request(path, navigate) {
      if (!open) {
        navigate(path);
        return 'now';
      }
      held = { path, navigate };
      options.onQueued?.(path);
      return 'queued';
    },
    flowEnded() {
      open = false;
      const next = held;
      held = null;
      if (!next) return null;
      next.navigate(next.path);
      return next.path;
    },
    pending: () => held?.path ?? null,
    clear() {
      held = null;
    },
  };
}

/**
 * Sign-out or an expired session: close an open Pulse flow from Huddle's side
 * (`reason: 'host'`; the take is kept as a draft) and drop any navigation held
 * for the old session. Returns whether a flow was open. Never rejects: the
 * sign-out goes on whatever Pulse answers.
 */
export async function closeForSignOut(
  client: Pick<PulseClient, 'isOpen' | 'close'>,
  queue?: NavigationQueue | null,
): Promise<boolean> {
  queue?.clear();
  let open = queue?.isOpen() ?? false;
  try {
    open = (await client.isOpen()) || open;
    if (open) await client.close({ reason: 'host' });
  } catch (error) {
    console.warn('[pulse-embed] closing Pulse at sign-out failed:', error);
  }
  return open;
}
