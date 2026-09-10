/** Common IANA zones, used when `Intl.supportedValuesOf` isn't available (older WebViews). */
const FALLBACK_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Jerusalem',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function supportedTimeZones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supportedValuesOf === 'function') {
    try {
      return supportedValuesOf('timeZone');
    } catch {
      // fall through to the curated list
    }
  }
  return FALLBACK_TIME_ZONES;
}

/** `{ value, label }` options for a timezone `Select`, sorted for display. */
export function getTimezoneOptions(): Array<{ value: string; label: string }> {
  return supportedTimeZones()
    .map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
