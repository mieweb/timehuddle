/**
 * FilterDropdown — an icon trigger plus a portaled menu, used for the ticket
 * table's column filters.
 *
 * The menu is portaled to <body> and positioned with `fixed` coordinates rather
 * than using `@mieweb/ui`'s `Dropdown` directly, because the filter row scrolls
 * horizontally on mobile: per the CSS overflow spec, setting overflow on one
 * axis makes the other axis clip too, which silently cuts off a normally
 * positioned menu docked below the row.
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
  children: React.ReactNode;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
  activeMenuId,
  menuId,
  boundaryRef,
  onOpenChange,
  trigger,
  triggerAriaLabel,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
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
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: Math.max(gutter, rect.left),
      right: 'auto',
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

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
      if (e.key === 'Escape') handleOpenChange(false);
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
        onClick={() => handleOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        // The trigger takes only the icon's width: `Button`'s default `h-10 px-4`
        // squeezed header labels into ellipses and, in narrow columns, clipped
        // the icon away entirely.
        className="flex h-auto shrink-0 items-center rounded p-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        {trigger}
      </Button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="z-9999 max-w-[calc(100vw-1rem)] min-w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            /* Clicking any item bubbles up here and closes the dropdown */
            onClick={() => handleOpenChange(false)}
          >
            <DropdownContent className="max-h-[60vh] overflow-y-auto bg-white shadow-lg dark:bg-neutral-800">
              {children}
            </DropdownContent>
          </div>,
          document.body,
        )}
    </>
  );
};
