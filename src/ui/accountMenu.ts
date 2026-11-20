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

import { getAppUrl, storeUrlFor } from '../lib/appLinks';
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
  /** The store item's name: "App Store", "Google Play", or "Get the App" when the device is unknown. */
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
// When it can't be told (a laptop, or Android Chrome in Desktop site mode),
// /get-app offers both stores rather than guessing one.
const mobileOS = getMobileOS();
const STORE_LABELS = { ios: 'App Store', android: 'Google Play' } as const;
const storeLabel = mobileOS ? STORE_LABELS[mobileOS] : 'Get the App';
const openAppStore = () => void openExternalUrl(mobileOS ? storeUrlFor(mobileOS) : getAppUrl());

/** Account-menu sections, wired to the app's feedback modals. */
export function useAccountMenuSections(): AccountMenuSection[] {
  const { openFeedback, openReportIssue } = useAppFeedback();
  return useMemo(
    () => buildAccountMenuSections({ openReportIssue, openFeedback, openAppStore, storeLabel }),
    [openReportIssue, openFeedback],
  );
}
