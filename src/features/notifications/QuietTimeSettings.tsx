/**
 * "Quiet time" (#784): hold pop-ups while clocked out, or snooze them all for a
 * while. Held alerts are still logged under the bell. Rendered inside a
 * Settings card.
 */
import { Button, ButtonGroup, Switch, Text } from '@mieweb/ui';
import React from 'react';

import type { NotificationQuiet } from '../../lib/api';
import { NOTIFICATION_STRINGS as S } from './notificationCopy';
import { PrefsStatus } from './PrefsStatus';
import { useNotificationPrefs } from './useNotificationPrefs';

type Snooze = keyof typeof S.snoozeOptions;

const HOUR_MS = 60 * 60 * 1000;
/** "Until tomorrow" ends at this local hour the next day. */
const MORNING_HOUR = 8;

/** The quiet-time change each snooze choice makes, from `now`. */
export function snoozeChange(choice: Snooze, now = new Date()): Partial<NotificationQuiet> {
  switch (choice) {
    case 'hour':
      return {
        snoozeUntil: new Date(now.getTime() + HOUR_MS).toISOString(),
        snoozeUntilClockIn: false,
      };
    case 'tomorrow': {
      const morning = new Date(now);
      morning.setDate(morning.getDate() + 1);
      morning.setHours(MORNING_HOUR, 0, 0, 0);
      return { snoozeUntil: morning.toISOString(), snoozeUntilClockIn: false };
    }
    case 'clockIn':
      return { snoozeUntil: null, snoozeUntilClockIn: true };
    default:
      return { snoozeUntil: null, snoozeUntilClockIn: false };
  }
}

/** Which snooze is on, and the line describing it. An ended snooze reads as off. */
function snoozeState(
  quiet: NotificationQuiet,
  now = new Date(),
): { current: Snooze | null; status: string } {
  if (quiet.snoozeUntilClockIn) return { current: 'clockIn', status: S.snoozeStatusClockIn };
  const until = quiet.snoozeUntil ? new Date(quiet.snoozeUntil) : null;
  if (!until || until <= now) return { current: 'off', status: S.snoozeStatusOff };
  const when = until.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  // A timed snooze isn't tied to one button once set, so none is shown as selected.
  return { current: null, status: S.snoozeStatusUntil(when) };
}

/** One quiet-time on/off setting: label and hint, with its switch. */
const QuietSwitchRow: React.FC<{
  className: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}> = ({ className, label, hint, checked, onChange }) => (
  <div className={`${className} flex items-center justify-between gap-4 px-5 py-3.5`}>
    <div className="min-w-0">
      <Text size="sm" weight="medium">
        {label}
      </Text>
      <Text variant="muted" size="xs" className="mt-0.5">
        {hint}
      </Text>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
  </div>
);

export const QuietTimeSettings: React.FC = () => {
  const { prefs, error, setQuiet } = useNotificationPrefs();
  const snooze = prefs && snoozeState(prefs.quiet);

  return (
    <div className="quiet-time-settings">
      <PrefsStatus loading={!prefs} error={error} />
      {prefs && snooze && (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          <QuietSwitchRow
            className="quiet-hold-off-shift"
            label={S.holdOffShift}
            hint={S.holdOffShiftHint}
            checked={prefs.quiet.holdOffShift}
            onChange={(on) => setQuiet({ holdOffShift: on })}
          />
          <QuietSwitchRow
            className="quiet-skip-while-viewing"
            label={S.skipWhileViewing}
            hint={S.skipWhileViewingHint}
            checked={prefs.quiet.skipWhileViewing}
            onChange={(on) => setQuiet({ skipWhileViewing: on })}
          />
          <div className="quiet-snooze flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <Text size="sm" weight="medium">
                {S.snooze}
              </Text>
              <Text variant="muted" size="xs" className="mt-0.5" aria-live="polite">
                {snooze.status}
              </Text>
            </div>
            <ButtonGroup role="radiogroup" aria-label={S.snooze}>
              {(Object.keys(S.snoozeOptions) as Snooze[]).map((choice) => {
                const selected = snooze.current === choice;
                return (
                  <Button
                    key={choice}
                    size="sm"
                    variant={selected ? 'primary' : 'outline'}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setQuiet(snoozeChange(choice))}
                  >
                    {S.snoozeOptions[choice]}
                  </Button>
                );
              })}
            </ButtonGroup>
          </div>
        </div>
      )}
    </div>
  );
};
