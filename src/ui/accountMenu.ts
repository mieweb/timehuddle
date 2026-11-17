/**
 * accountMenu — the Help group of the account menu.
 *
 * Single source for these items. UserDropdown renders them
 * as a dropdown section; BottomNav renders them as the More sheet's drill-down
 * tile. Keeping both on one definition is what stops the avatar menu and the
 * mobile sheet drifting apart again.
 *
 * Admin and Developer pages are not here: Enterprise and People are in the
 * main nav, and Usage and Seeder are sections of Settings.
 */
import {
  ExternalLinkIcon,
  FlagIcon,
  HelpCircleIcon,
  MessageIcon,
  type LucideIcon,
} from '@mieweb/ui';
import { useMemo } from 'react';

import { storeUrlFor } from '../lib/appLinks';
import { getMobileOS, openExternalUrl } from '../lib/device';
import { useAppFeedback } from './AppLayout';

export type AccountMenuSectionId = 'help';

export interface AccountMenuItem {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

export interface AccountMenuSection {
  id: AccountMenuSectionId;
  label: string;
  icon: LucideIcon;
  items: AccountMenuItem[];
}

export interface AccountMenuActions {
  openReportIssue: () => void;
  openFeedback: () => void;
  openAppStore: () => void;
  /** The store item's name: "Google Play" on Android, "App Store" everywhere else. */
  storeLabel?: string;
}

/** The account menu's sections, in display order. */
export function buildAccountMenuSections({
  openReportIssue,
  openFeedback,
  openAppStore,
  storeLabel = 'App Store',
}: AccountMenuActions): AccountMenuSection[] {
  return [
    {
      id: 'help',
      label: 'Help',
      icon: HelpCircleIcon,
      items: [
        { icon: FlagIcon, label: 'Report an Issue', onSelect: openReportIssue },
        { icon: MessageIcon, label: 'Share Your Feedback', onSelect: openFeedback },
        { icon: ExternalLinkIcon, label: storeLabel, onSelect: openAppStore },
      ],
    },
  ];
}

// The device can't change while the app runs, so the store is picked once.
const isAndroid = getMobileOS() === 'android';
const storeLabel = isAndroid ? 'Google Play' : 'App Store';
const openAppStore = () => void openExternalUrl(storeUrlFor(isAndroid ? 'android' : 'ios'));

/** Account-menu sections, wired to the app's feedback modals. */
export function useAccountMenuSections(): AccountMenuSection[] {
  const { openFeedback, openReportIssue } = useAppFeedback();
  return useMemo(
    () => buildAccountMenuSections({ openReportIssue, openFeedback, openAppStore, storeLabel }),
    [openReportIssue, openFeedback],
  );
}
