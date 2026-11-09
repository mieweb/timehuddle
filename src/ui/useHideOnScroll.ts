/**
 * Whether a page's chrome should tuck away to give a scrolling list the room:
 * true once a list inside `containerRef` scrolls down, false again as soon as
 * it scrolls back up a little, or reaches its top.
 *
 * Phone only (the bottom-nav width), where the room matters; a list that is
 * mid-drag (`SortableList` marks the lifted row) leaves it as it is, so the
 * layout doesn't move under the finger.
 *
 * Two kinds of movement aren't the member scrolling, and are ignored: iOS's
 * rubber-band past the list's end springing back, and the scroll position
 * shifting while the chrome folds (the list grows or shrinks under it).
 */
import { useEffect, useState, type RefObject } from 'react';

/** Scrolled this far down from the last turn before the chrome hides. */
const HIDE_AFTER = 12;
/** Scrolled this far back up before it shows again. */
const SHOW_AFTER = 6;
/** After folding or unfolding, the layout settles for this long (the fold's duration). */
const SETTLE_MS = 250;
const PHONE = '(max-width: 767px)';

export function useHideOnScroll(containerRef: RefObject<HTMLElement | null>): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const phone = window.matchMedia(PHONE);
    // Where each scroller was, and where its current run in one direction began.
    const last = new WeakMap<Element, { top: number; turn: number }>();
    let settleUntil = 0;
    const set = (next: boolean) =>
      setHidden((prev) => {
        if (prev !== next) settleUntil = performance.now() + SETTLE_MS;
        return next;
      });

    // Scroll events don't bubble, so the container listens in the capture phase.
    const onScroll = (e: Event) => {
      const el = e.target as Element;
      if (!(el instanceof HTMLElement) || !phone.matches) return;
      if (document.querySelector('[data-sortable-id][data-dragging]')) return;
      const top = el.scrollTop;
      const end = el.scrollHeight - el.clientHeight;
      // At or past the end (a bounce), or while the fold settles: note where
      // the list is, so the next real scroll measures from here, and stop.
      if (top >= end - 1 || performance.now() < settleUntil) {
        last.set(el, { top, turn: top });
        return;
      }
      const prev = last.get(el) ?? { top, turn: top };
      const goingDown = top > prev.top;
      const turned = goingDown !== prev.top - prev.turn >= 0;
      const turn = turned ? prev.top : prev.turn;
      last.set(el, { top, turn });
      if (top <= 0) set(false);
      else if (goingDown && top - turn > HIDE_AFTER) set(true);
      else if (!goingDown && turn - top > SHOW_AFTER) set(false);
    };
    const onPhoneChange = () => phone.matches || setHidden(false);

    container.addEventListener('scroll', onScroll, { capture: true, passive: true });
    phone.addEventListener('change', onPhoneChange);
    return () => {
      container.removeEventListener('scroll', onScroll, { capture: true });
      phone.removeEventListener('change', onPhoneChange);
    };
  }, [containerRef]);

  return hidden;
}
