/**
 * PullToRefresh — Wrapper component that adds pull-to-refresh functionality.
 *
 * Features:
 *   • Only activates on touch-capable devices (mobile web + native)
 *   • Disabled when sidebar drawer or modal is open
 *   • Haptic feedback on native platforms (light on pull, medium on release)
 *   • Uses @mieweb/ui Spinner with subtle text
 *   • Calls RefreshContext triggerRefresh() on pull
 */
import React, { useCallback, useEffect, useState } from 'react';
import PullToRefreshLib from 'react-simple-pull-to-refresh';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Spinner } from '@mieweb/ui';

import { useSidebar } from './AppLayout';
import { useRefreshTrigger } from '@lib/RefreshContext';

// ─── Pull-to-Refresh Wrapper ──────────────────────────────────────────────────

interface PullToRefreshProps {
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ children }) => {
  const { isMobileOpen } = useSidebar();
  const triggerRefresh = useRefreshTrigger();

  // Detect touch support (mobile web + native)
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // Detect if modal is open
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const checkModal = () => {
      setIsModalOpen(document.querySelector('[role="dialog"]') !== null);
    };

    // Check on mount and set up observer for DOM changes
    checkModal();

    const observer = new MutationObserver(checkModal);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role'],
    });

    return () => observer.disconnect();
  }, []);

  // Determine if pull-to-refresh should be disabled
  const isPullDisabled = !isTouchDevice || isMobileOpen || isModalOpen;

  // Handle refresh with haptic feedback
  const handleRefresh = useCallback(async () => {
    // Trigger haptic feedback on native platforms
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (err) {
        // Haptics may not be available on all devices
        console.warn('[PullToRefresh] Haptic feedback failed:', err);
      }
    }

    // Execute refresh
    await triggerRefresh();

    // Medium impact on completion
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } catch (err) {
        console.warn('[PullToRefresh] Haptic feedback failed:', err);
      }
    }
  }, [triggerRefresh]);

  // If pull-to-refresh is disabled, just render children
  if (isPullDisabled) {
    return <>{children}</>;
  }

  // Render with pull-to-refresh wrapper
  return (
    <PullToRefreshLib
      onRefresh={handleRefresh}
      pullingContent={
        <div className="flex flex-col items-center justify-center py-4">
          <Spinner size="sm" />
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Pull to refresh...
          </p>
        </div>
      }
      refreshingContent={
        <div className="flex flex-col items-center justify-center py-4">
          <Spinner size="sm" />
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">Refreshing...</p>
        </div>
      }
      resistance={2}
      maxPullDownDistance={100}
      pullDownThreshold={65}
    >
      {children}
    </PullToRefreshLib>
  );
};
