/**
 * accountMenu — the Help group of the account menu.
 *
 * Single source for these items and APP_STORE_URL. UserDropdown renders them
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

import { openExternalUrl } from '../lib/device';
import { useAppFeedback } from './AppLayout';

export const APP_STORE_URL = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

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
}

/** The account menu's sections, in display order. */
export function buildAccountMenuSections({
  openReportIssue,
  openFeedback,
  openAppStore,
}: AccountMenuActions): AccountMenuSection[] {
  return [
    {
      id: 'help',
      label: 'Help',
      icon: HelpCircleIcon,
      items: [
        { icon: FlagIcon, label: 'Report an Issue', onSelect: openReportIssue },
        { icon: MessageIcon, label: 'Share Your Feedback', onSelect: openFeedback },
        { icon: ExternalLinkIcon, label: 'App Store', onSelect: openAppStore },
      ],
    },
  ];
}

const openAppStore = () => void openExternalUrl(APP_STORE_URL);

/** Account-menu sections, wired to the app's feedback modals. */
export function useAccountMenuSections(): AccountMenuSection[] {
  const { openFeedback, openReportIssue } = useAppFeedback();
  return useMemo(
    () => buildAccountMenuSections({ openReportIssue, openFeedback, openAppStore }),
    [openReportIssue, openFeedback],
  );
}
