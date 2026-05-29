/**
 * PullToRefresh — Custom pull-to-refresh wrapper.
 *
 * Unlike react-simple-pull-to-refresh, this implementation only captures the
 * touch gesture AFTER the user has clearly pulled ≥ ACTIVATION_PX downward.
 * This ensures taps on buttons, dropdowns, and modals are never blocked.
 *
 * Features:
 *   • Only activates on touch-capable devices
 *   • Does NOT intercept taps or touches on interactive elements
 *   • Disabled when sidebar drawer is open
 *   • Haptic feedback on native platforms
 *   • Does NOT call preventDefault until the pull is clearly intentional
 */
import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Spinner } from '@mieweb/ui';

import { useSidebar } from './AppLayout';
import { useRefreshTrigger } from '@lib/RefreshContext';

// ─── Constants ────────────────────────────────────────────────────────────────

/** px of downward movement before we take over the gesture (allows taps through) */
const ACTIVATION_PX = 15;
/** px of visual pull distance required to trigger a refresh */
const THRESHOLD_PX = 75;
/** Maximum visual pull distance */
const MAX_PX = 110;
/** Higher = harder to pull */
const RESISTANCE = 2.5;
/** Height of the refreshing indicator once a refresh fires */
const INDICATOR_HEIGHT = 52;

/** CSS selector for elements that should never trigger pull-to-refresh */
const INTERACTIVE_SELECTORS =
  'button, a, input, textarea, select, ' +
  '[role="button"], [role="combobox"], [role="option"], ' +
  '[role="menuitem"], [role="tab"], [role="switch"], ' +
  '[role="checkbox"], [role="radio"], [role="dialog"]';

// ─── Component ────────────────────────────────────────────────────────────────

interface PullToRefreshProps {
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ children }) => {
  const { isMobileOpen } = useSidebar();
  const triggerRefresh = useRefreshTrigger();

  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use refs for all touch state — event handlers are attached once and must
  // not be re-registered on every render to avoid listener accumulation.
  const isMobileOpenRef = useRef(isMobileOpen);
  const triggerRefreshRef = useRef(triggerRefresh);
  const isRefreshingRef = useRef(false);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const activeRef = useRef(false); // true once gesture is confirmed as a pull
  const blockedRef = useRef(false); // true if this touch should be ignored
  const pullYRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with latest prop/context values
  useEffect(() => {
    isMobileOpenRef.current = isMobileOpen;
  }, [isMobileOpen]);
  useEffect(() => {
    triggerRefreshRef.current = triggerRefresh;
  }, [triggerRefresh]);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (!isTouchDevice) return;
    const el = containerRef.current;
    if (!el) return;

    /** Returns the scroll offset of the nearest scroll container ancestor.
     *  Walking UP from containerRef finds <main> (which is the real scroll
     *  container for all pages), rather than looking at children only. */
    const getScrollTop = (): number => {
      // Prefer the <main> element (the primary page scroll container)
      const mainEl = el.closest('main');
      if (mainEl) return mainEl.scrollTop;
      // Fallback: walk ancestors
      let node: Element | null = el.parentElement;
      while (node) {
        if (node.scrollTop > 0) return node.scrollTop;
        node = node.parentElement;
      }
      return 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      activeRef.current = false;
      blockedRef.current = false;
      pullYRef.current = 0;

      // Block if sidebar open or already refreshing
      if (isMobileOpenRef.current || isRefreshingRef.current) {
        blockedRef.current = true;
        return;
      }

      // Block if touch started on an interactive element (button, link, dropdown, etc.)
      const target = e.target as Element | null;
      if (target?.closest(INTERACTIVE_SELECTORS)) {
        blockedRef.current = true;
        return;
      }

      startYRef.current = e.touches[0].clientY;
      startXRef.current = e.touches[0].clientX;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (blockedRef.current) return;

      const dy = e.touches[0].clientY - startYRef.current;
      const dx = Math.abs(e.touches[0].clientX - startXRef.current);

      // Horizontal-dominant swipe — hand off to sidebar drawer or other handler
      if (dx > Math.abs(dy) + 5) {
        blockedRef.current = true;
        return;
      }

      // Not pulling downward
      if (dy <= 0) return;

      // Page is not at the top — allow normal scrolling
      if (getScrollTop() > 2) return;

      // ─── Key fix: don't take over until the user has CLEARLY pulled ──────────
      // Taps involve < ACTIVATION_PX of movement and pass through unmodified,
      // so buttons, dropdowns, and modal triggers all work normally.
      if (dy < ACTIVATION_PX && !activeRef.current) return;

      // Deliberate pull confirmed — take over the gesture
      activeRef.current = true;
      e.preventDefault(); // blocks scroll + kills any pending tap/click

      const visual = Math.min(dy / RESISTANCE, MAX_PX);
      pullYRef.current = visual;
      setPullY(visual);
    };

    const onTouchEnd = async () => {
      if (!activeRef.current) {
        setPullY(0);
        pullYRef.current = 0;
        return;
      }
      activeRef.current = false;

      const dist = pullYRef.current;
      setPullY(0);
      pullYRef.current = 0;

      if (dist >= THRESHOLD_PX / RESISTANCE) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);

        if (Capacitor.isNativePlatform()) {
          try {
            await Haptics.impact({ style: ImpactStyle.Medium });
          } catch {
            // Haptics not available on all devices
          }
        }

        try {
          await triggerRefreshRef.current();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
        }
      }
    };

    const onTouchCancel = () => {
      activeRef.current = false;
      blockedRef.current = false;
      setPullY(0);
      pullYRef.current = 0;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [isTouchDevice]); // attach once — refs keep values current

  if (!isTouchDevice) {
    return <>{children}</>;
  }

  const showIndicator = pullY > 5 || isRefreshing;
  const isReady = pullY >= THRESHOLD_PX / RESISTANCE;
  const indicatorHeight = isRefreshing ? INDICATOR_HEIGHT : pullY;

  return (
    // Flex-column layout: spacer expands to show the indicator, content fills
    // the rest. Using height instead of CSS transform avoids creating a new
    // stacking context, which would break position:fixed modal backdrops.
    <div ref={containerRef} className="flex min-h-full w-full flex-col">
      {/* Pull indicator — spacer height grows to reveal spinner */}
      <div
        aria-hidden
        className="flex shrink-0 items-end justify-center gap-2 overflow-hidden"
        style={{
          height: indicatorHeight,
          transition: pullY === 0 && !isRefreshing ? 'height 0.2s ease-out' : 'none',
        }}
      >
        {showIndicator && (
          <>
            <Spinner size="sm" />
            <span className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
              {isRefreshing
                ? 'Refreshing...'
                : isReady
                  ? 'Release to refresh'
                  : 'Pull to refresh...'}
            </span>
          </>
        )}
      </div>

      {/* Page content — normal document flow, no transform, no stacking context */}
      <div>{children}</div>
    </div>
  );
};
