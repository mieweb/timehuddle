/**
 * AnchoredMenu — a dropdown portaled to <body> and positioned with `fixed`
 * coordinates read from its trigger's rect.
 *
 * An anchored menu inside a scroll container cannot use `position: absolute`:
 * once one overflow axis is non-`visible` the CSS overflow spec forces the
 * other to clip too, so a menu opening below its trigger is silently hidden.
 * That is exactly what swallowed the Ticket / @Mention menus on the Huddle
 * feed, whose composer lives in an `overflow-y-auto` wrapper — the same
 * failure the ticket row options menu hits. Portaling out of the container is
 * the only reliable fix.
 *
 * The menu also flips above the trigger when there isn't room below, and
 * exposes the space it has as `max-height` so long lists scroll inside it
 * instead of running off-screen.
 *
 * Because the menu is portaled to the end of <body>, a keyboard user left on
 * the trigger would have to Tab through the rest of the page to reach it. So on
 * open focus moves into the menu container (not into a search field — focusing
 * one scrolls the composer and pops the mobile keyboard over the list being
 * picked from), arrow keys walk the `role="menuitem"` children, and focus
 * returns to the trigger on close.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Breathing room kept between the menu and the trigger / viewport edges. */
const GUTTER = 8;
/** Below this much space under the trigger, the menu flips above it. */
const FLIP_THRESHOLD = 200;
/** Keys that move the roving focus between menu items. */
const MOVEMENT_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

interface AnchoredMenuProps {
  open: boolean;
  /** Called on Escape or a pointer press outside both menu and trigger. */
  onClose: () => void;
  /** The element the menu aligns to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Preferred width in px, clamped to the viewport. */
  width: number;
  /** Accessible name for the menu. */
  label: string;
  testId?: string;
  children: ReactNode;
}

export function AnchoredMenu({
  open,
  onClose,
  anchorRef,
  width,
  label,
  testId,
  children,
}: AnchoredMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // null until measured, so the menu never paints one frame at the wrong spot.
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    const reposition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const menuWidth = Math.min(width, window.innerWidth - GUTTER * 2);
      const left = Math.min(Math.max(GUTTER, rect.left), window.innerWidth - GUTTER - menuWidth);
      const spaceBelow = window.innerHeight - rect.bottom - GUTTER * 2;
      const spaceAbove = rect.top - GUTTER * 2;
      const flipUp = spaceBelow < FLIP_THRESHOLD && spaceAbove > spaceBelow;

      setStyle({
        position: 'fixed',
        left,
        width: menuWidth,
        // Exactly the space available on the chosen side, with no floor: the
        // flip above already picks the roomier side, so clamping up to a
        // minimum here would only push the menu back off-screen on a short
        // viewport. A cramped-but-scrollable menu beats a clipped one.
        maxHeight: Math.max(0, flipUp ? spaceAbove : spaceBelow),
        ...(flipUp
          ? { bottom: window.innerHeight - rect.top + GUTTER }
          : { top: rect.bottom + GUTTER }),
      });
    };

    // Scroll fires far faster than the screen repaints, and each run costs a
    // layout-forcing getBoundingClientRect plus a setState — coalesce to one
    // per frame so dragging a long list stays smooth.
    let frame = 0;
    const scheduleReposition = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };

    reposition();
    window.addEventListener('resize', scheduleReposition);
    // Capture phase, so scrolling any ancestor container re-anchors the menu.
    window.addEventListener('scroll', scheduleReposition, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleReposition);
      window.removeEventListener('scroll', scheduleReposition, true);
    };
  }, [open, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The trigger owns its own toggle — closing here would fight it.
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!MOVEMENT_KEYS.has(event.key)) return;
      // Only steer the menu while focus is actually inside it, so arrow keys in
      // the page behind an open menu still scroll normally.
      const menu = menuRef.current;
      if (!menu?.contains(document.activeElement)) return;

      const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (items.length === 0) return;
      event.preventDefault();

      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? // From the search field (not an item) ArrowDown enters at the top.
                current < 0
                ? 0
                : (current + 1) % items.length
              : current <= 0
                ? items.length - 1
                : current - 1;
      items[next]?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, anchorRef]);

  // Move focus into the menu on open and hand it back to the trigger on close —
  // but only if focus is still inside the menu, so clicking elsewhere on the
  // page doesn't get yanked back to the trigger. `preventScroll` keeps the
  // composer's scroll container from jumping to reveal the portaled menu.
  //
  // Gated on `positioned`, not on `style`: nothing is rendered until the first
  // measurement lands, so keying off `open` alone would run this before the
  // portal exists — and keying off `style` would re-steal focus from the item
  // the user arrowed to on every scroll reposition.
  const positioned = style !== null;
  useEffect(() => {
    if (!open || !positioned) return;
    const menu = menuRef.current;
    menu?.focus({ preventScroll: true });
    return () => {
      if (menu?.contains(document.activeElement)) {
        anchorRef.current?.focus({ preventScroll: true });
      }
    };
  }, [open, positioned, anchorRef]);

  if (!open || !style || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      // Focusable so open can land focus here rather than on a text field.
      tabIndex={-1}
      aria-label={label}
      data-testid={testId}
      style={style}
      className="z-[99999] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-800"
    >
      {children}
    </div>,
    document.body,
  );
}
