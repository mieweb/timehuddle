/**
 * FilterDropdown — a trigger plus a portaled menu, used for the ticket list's
 * sort and filter pills (`TicketListControls`) and each row's ⋮ menu
 * (`TicketRow`), so all of them share one keyboard and focus model.
 *
 * The menu is portaled to <body> and positioned with `fixed` coordinates rather
 * than using `@mieweb/ui`'s `Dropdown` directly, because the list card clips
 * its overflow (for its rounded corners and scrolling rows), which would
 * silently cut off a normally positioned menu docked below the header.
 */
import { Button, DropdownContent } from '@mieweb/ui';
import React from 'react';
import { createPortal } from 'react-dom';

export interface FilterDropdownProps {
  /** The id of the currently open filter menu. Used to close this dropdown
   *  when a sibling opens. Set to a different non-null string to force close. */
  activeMenuId?: string | null;
  /** This dropdown's own id — used to decide whether to self-close. */
  menuId?: string;
  /** Container the menu must stay within (e.g. the ticket list card) — the
   *  menu is clamped to this element's bounds in addition to the viewport. */
  boundaryRef?: React.RefObject<HTMLElement | null>;
  onOpenChange?: (open: boolean) => void;
  /** What the trigger button shows, e.g. a filter icon. */
  trigger: React.ReactNode;
  /** Accessible name for the trigger. */
  triggerAriaLabel?: string;
  /** Added to the trigger button, e.g. to round its focus ring to the trigger's shape. */
  triggerClassName?: string;
  children: React.ReactNode;
}

/** What each navigation key does to the focused menu item. */
const MENU_KEY_STEP: Record<string, 1 | -1 | 'first' | 'last' | undefined> = {
  ArrowDown: 1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
};

/** Something in the menu to type in: its own keys stay its own. */
const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * The choices the keyboard can land on. A disabled one is skipped: it cannot
 * take focus, so stepping onto it would leave focus where it was.
 */
const menuItems = (menu: HTMLElement | null) =>
  menu
    ? Array.from(
        menu.querySelectorAll<HTMLElement>(
          ':is([role="menuitem"], [role="menuitemcheckbox"]):not(:disabled, [aria-disabled="true"])',
        ),
      )
    : [];

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  activeMenuId,
  menuId,
  boundaryRef,
  onOpenChange,
  trigger,
  triggerAriaLabel,
  triggerClassName = 'rounded',
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  // Whether the trigger was pressed with a key (a click with no pointer).
  const openedByKeyRef = React.useRef(false);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({});

  // Close when another dropdown in the group becomes active
  React.useEffect(() => {
    if (activeMenuId !== null && activeMenuId !== undefined && activeMenuId !== menuId) {
      setOpen(false);
    }
  }, [activeMenuId, menuId]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const shiftAppliedRef = React.useRef(false);

  // The menu is portaled to <body> and positioned with `fixed` coordinates
  // computed from the trigger's own rect — see the file header for why.
  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    shiftAppliedRef.current = false;
    const top = rect.bottom + 8;
    setMenuStyle({
      position: 'fixed',
      top,
      left: Math.max(gutter, rect.left),
      right: 'auto',
      // Never taller than the room under the trigger, so the last choices of
      // a long menu can always be scrolled to, even on a short screen.
      ['--menu-max-height' as string]: `${Math.max(120, window.innerHeight - top - gutter)}px`,
    });
  }, []);

  // Scrolling what the trigger sits in closes the menu, as a menu does: kept
  // open, it would ride along over the list's header. Other scrolling only
  // moves it: the menu's own list, the page as a whole, and the scroll iOS
  // makes to show the keyboard for a search box inside the menu.
  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const handleScroll = (e: Event) => {
      const target = e.target;
      const menu = menuRef.current;
      if (target instanceof Node && menu?.contains(target)) return;
      const typingInMenu =
        isTextEntry(document.activeElement) && menu?.contains(document.activeElement);
      if (
        target instanceof Element &&
        triggerRef.current &&
        target.contains(triggerRef.current) &&
        !typingInMenu
      ) {
        handleOpenChange(false);
        return;
      }
      updatePosition();
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updatePosition, handleOpenChange]);

  // `updatePosition` anchors the menu to the trigger before its actual
  // (content-dependent) width is known, so a menu docked near a screen edge
  // — e.g. "Assignee" wrapping to bottom-start on mobile — can still render
  // partly off-screen or spill outside the ticket list card. Once mounted,
  // measure the real box and nudge it back within the viewport (and the
  // card, if `boundaryRef` is given). Guarded by a ref (reset each time it
  // opens) so the resulting `setMenuStyle` call doesn't re-trigger itself.
  React.useEffect(() => {
    if (!open) shiftAppliedRef.current = false;
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || shiftAppliedRef.current) return;
    const menu = menuRef.current;
    if (!menu) return;
    shiftAppliedRef.current = true;
    const rect = menu.getBoundingClientRect();
    const gutter = 8;
    const boundaryRect = boundaryRef?.current?.getBoundingClientRect();
    const maxRight = boundaryRect
      ? Math.min(window.innerWidth - gutter, boundaryRect.right - gutter)
      : window.innerWidth - gutter;
    const minLeft = boundaryRect ? Math.max(gutter, boundaryRect.left + gutter) : gutter;
    const overflowRight = rect.right - maxRight;
    const overflowLeft = minLeft - rect.left;
    if (overflowRight > 0) {
      setMenuStyle((prev) =>
        typeof prev.left === 'number'
          ? { ...prev, left: Math.max(minLeft, prev.left - overflowRight) }
          : prev,
      );
    } else if (overflowLeft > 0) {
      setMenuStyle((prev) =>
        typeof prev.left === 'number' ? { ...prev, left: prev.left + overflowLeft } : prev,
      );
    }
  }, [open, menuStyle, boundaryRef]);

  // The menu is portaled to the end of <body>, far from its trigger in the tab
  // order, so focus is moved into it when it opens.
  React.useEffect(() => {
    if (!open) return;
    // A menu with a search box starts there (`data-menu-autofocus`), but only
    // where typing is likely: with a mouse or trackpad, or opened from the
    // keyboard. On a touchscreen, focusing it would raise the on-screen
    // keyboard over a menu most people open to tap a choice.
    const typing = openedByKeyRef.current || window.matchMedia('(pointer: fine)').matches;
    const first =
      (typing && menuRef.current?.querySelector<HTMLElement>('[data-menu-autofocus]')) ||
      menuItems(menuRef.current)[0];
    first?.focus();
  }, [open]);

  // Close on outside click / Escape — the library's Dropdown handles this
  // internally, but we're no longer using it for the menu itself since it
  // needs to live in a portal.
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      handleOpenChange(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleOpenChange(false);
        triggerRef.current?.focus();
        return;
      }
      // Everything below is the menu's own keyboard handling, so it applies
      // only while focus is inside it: a key pressed in some other control
      // keeps its normal meaning there.
      if (!menuRef.current?.contains(e.target as Node)) return;
      // Tab leaves the menu, as in any menu: it closes, and focus carries on
      // from the trigger rather than from the end of <body>.
      if (e.key === 'Tab') {
        handleOpenChange(false);
        triggerRef.current?.focus();
        return;
      }
      // Arrow keys walk the choices.
      const step = MENU_KEY_STEP[e.key];
      const items = menuItems(menuRef.current);
      if (step === undefined || !items.length) return;
      // In a search box Home and End move the caret; the arrows still leave it.
      if (isTextEntry(e.target) && typeof step !== 'number') return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next =
        step === 'first'
          ? 0
          : step === 'last'
            ? items.length - 1
            : current === -1
              ? // From outside the choices (the search box): into the nearest end.
                step === 1
                ? 0
                : items.length - 1
              : (current + step + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleOpenChange]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        type="button"
        onClick={(e) => {
          openedByKeyRef.current = e.detail === 0;
          handleOpenChange(!open);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        // The trigger takes only the icon's width: `Button`'s default `h-10 px-4`
        // squeezed header labels into ellipses and, in narrow columns, clipped
        // the icon away entirely.
        className={`flex h-auto shrink-0 items-center p-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${triggerClassName}`}
      >
        {trigger}
      </Button>
      {open &&
        createPortal(
          // \`w-max\`: sized by its choices, not by the room right of the trigger,
          // so a menu opened near the screen's edge is moved into view whole
          // rather than wrapped first.
          <div
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="z-9999 w-max max-w-[calc(100vw-1rem)] min-w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            /* Clicking any item bubbles up here and closes the dropdown. Focus
               goes back to the trigger: the item it was on is about to unmount. */
            onClick={(e) => {
              // Except in a part that is not a choice, such as a search box.
              if ((e.target as HTMLElement).closest('[data-menu-keep-open]')) return;
              handleOpenChange(false);
              triggerRef.current?.focus();
            }}
          >
            <DropdownContent className="max-h-[min(60vh,var(--menu-max-height,60vh))] overflow-y-auto bg-white shadow-lg dark:bg-neutral-800">
              {children}
            </DropdownContent>
          </div>,
          document.body,
        )}
    </>
  );
};
