/**
 * useInboxSlot — find an element inside SuperChatInbox to portal page content
 * into, for spots the inbox has no slot prop for yet (its list header).
 * Re-queried on every DOM change under `root`, since the inbox mounts,
 * unmounts and re-renders those elements on its own.
 *
 * Each use is a stopgap tied to SuperChat's internal markup: when @mieweb/ui
 * gains the matching prop, delete the use. The tracking list is
 * docs/superchat-inbox-gaps.md.
 */
import { useEffect, useState, type RefObject } from 'react';

// Where the page portals into SuperChatInbox. This depends on SuperChat's
// internal markup, which useInboxSlot.test.tsx pins against the installed
// @mieweb/ui so an upgrade that moves it fails a test instead of silently
// dropping the filters.

/** The conversation list's header row: holds the Team / Group by filters. */
export const findListHeader = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="superchat-conversations"] > div:first-child');

export function useInboxSlot(
  root: RefObject<HTMLElement | null>,
  find: (root: HTMLElement) => HTMLElement | null,
): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const rootEl = root.current;
    if (!rootEl) return;
    const update = () => setSlot(find(rootEl));
    update();
    const observer = new MutationObserver(update);
    observer.observe(rootEl, { childList: true, subtree: true });
    return () => observer.disconnect();
    // Pass a module-level `find`: a new function every render would re-attach
    // the observer every render.
  }, [root, find]);
  return slot;
}
