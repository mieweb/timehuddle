import { useEffect, useRef, type RefObject } from 'react';

/**
 * Escape, pressed inside `ref`'s element, calls `onEscape` — and goes no
 * further. A layer opened over another (a video's feed over the window that
 * lists it, a rename over either) closes alone: the library's Modal and
 * SuperChat listen for Escape on the document, so this claims it first, on
 * the window, as it is captured.
 */
export function useEscapeWithin(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  enabled = true,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ref.current?.contains(event.target as Node)) return;
      // A menu open from a control in it (a video's ⋯) closes first, alone.
      if ((event.target as Element).closest?.('[aria-expanded="true"]')) return;
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ref, enabled]);
}
