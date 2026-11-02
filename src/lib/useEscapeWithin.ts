import { useEffect, useRef, type RefObject } from 'react';

/**
 * Escape, when `claims` says it's this layer's (by the key's target), calls
 * `onEscape` — and goes no further. The library's Modal, Dropdown and
 * SuperChat listen for Escape on the document, so this takes it first, on the
 * window, as it is captured.
 */
function useClaimedEscape(
  claims: (target: Element) => boolean,
  onEscape: () => void,
  enabled: boolean,
): void {
  const claimsRef = useRef(claims);
  claimsRef.current = claims;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !claimsRef.current(event.target as Element)) return;
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

/**
 * Escape, pressed inside `ref`'s element, calls `onEscape` — and goes no
 * further. A layer opened over another (a video's feed over the window that
 * lists it, a rename over either) closes alone.
 */
export function useEscapeWithin(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true,
): void {
  useClaimedEscape(
    (target) =>
      !!ref.current?.contains(target) &&
      // A menu open from a control in it (a video's ⋯) closes first, alone.
      !target.closest?.('[aria-expanded="true"]'),
    onEscape,
    enabled,
  );
}

/**
 * Escape, wherever it's pressed, calls `onEscape` and goes no further: for the
 * topmost layer while it's open, such as a menu whose items are portaled to
 * the body, away from its trigger.
 */
export function useEscapeOnTop(onEscape: () => void, enabled = true): void {
  useClaimedEscape(() => true, onEscape, enabled);
}
