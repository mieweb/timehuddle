/**
 * How the usage report's values are labelled and coloured.
 *
 * Shared by OrgUsagePage (the summary cards) and UsageGrid (the rows) so a
 * cadence never reads one way in the cards and another in the table.
 */
import type { UsageCadence, UsageFeature, UsagePeriodDays, UsageStatus } from '../../lib/api';
import { USAGE_FEATURES } from '../../lib/api';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'danger' | 'warning' | 'success';

interface CadenceMeta {
  label: string;
  variant: BadgeVariant;
  /** What earns this label, for the legend under the cards. */
  hint: string;
}

/** Ordered most to least engaged — the cards and the legend both read it in order. */
export const CADENCE_META: Record<UsageCadence, CadenceMeta> = {
  daily: { label: 'Daily', variant: 'success', hint: '15+ active days' },
  weekly: { label: 'Weekly', variant: 'default', hint: '4–14 active days' },
  biweekly: { label: 'Biweekly', variant: 'secondary', hint: '2–3 active days' },
  monthly: { label: 'Monthly', variant: 'warning', hint: '1 active day' },
  dormant: { label: 'Dormant', variant: 'outline', hint: 'nothing at all' },
};

export const CADENCE_ORDER: UsageCadence[] = ['daily', 'weekly', 'biweekly', 'monthly', 'dormant'];

export const STATUS_META: Record<UsageStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  idle: { label: 'Idle', variant: 'outline' },
  blocked: { label: 'Blocked', variant: 'danger' },
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/** Descriptive form, for card labels and the grid title. */
export const PERIOD_LABEL: Record<UsagePeriodDays, string> = {
  1: 'Today',
  7: 'Last 7 days',
  14: 'Last 14 days',
  30: 'Last 30 days',
};

/** Short form, so all four selector pills fit across a phone. */
export const PERIOD_TAB_LABEL: Record<UsagePeriodDays, string> = {
  1: 'Today',
  7: '7 days',
  14: '14 days',
  30: '30 days',
};

const FEATURE_LABELS = Object.fromEntries(
  USAGE_FEATURES.map((feature) => [feature.key, feature.label]),
) as Record<UsageFeature, string>;

export function featureLabel(key: UsageFeature | null): string {
  return key ? FEATURE_LABELS[key] : '—';
}
