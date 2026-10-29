// Every user-facing string for notification preferences (#784), in one place
// until the app has i18n. The event keys match meteor-backend's
// notification-prefs-core.js EVENTS; their order here is the order shown. An
// event left out here isn't shown: `huddleReply` (comments on your post) stays
// hidden while Huddle has no way to comment (#784, M4).

import type { HuddleTeamLevel } from '../../lib/api';
import type { DefaultSettingRow } from '../settings/DefaultsCard';

export type NotificationDevice = 'desktop' | 'phone';

export const NOTIFICATION_DEVICES: NotificationDevice[] = ['desktop', 'phone'];

export interface NotificationEventCopy {
  key: string;
  label: string;
  hint?: string;
}

export interface NotificationEventGroup {
  label: string;
  events: NotificationEventCopy[];
}

export const NOTIFICATION_EVENT_GROUPS: NotificationEventGroup[] = [
  {
    label: 'Huddle',
    events: [
      { key: 'huddleMention', label: 'Someone @mentions me', hint: 'In a post or a comment' },
      {
        key: 'huddlePost',
        label: 'New posts in my teams',
        hint: 'Only for teams set to All posts',
      },
    ],
  },
  {
    label: 'Tickets',
    events: [
      { key: 'ticketAssigned', label: 'A ticket is assigned to me' },
      { key: 'ticketLink', label: 'A ticket I work on is linked or unlinked' },
    ],
  },
  {
    label: 'Time',
    events: [
      {
        key: 'shiftEnd',
        label: 'Shift-end reminder',
        hint: 'When you near 8 hours and are still clocked in',
      },
      {
        key: 'timesheetRequest',
        label: 'Timesheet change requests',
        hint: 'Admins: a member asks to change a timesheet',
      },
      {
        key: 'teamClock',
        label: 'A teammate clocks in or out',
        hint: 'Admins: including changes to a clock session',
      },
    ],
  },
  {
    label: 'Teams',
    events: [{ key: 'joinRequest', label: 'Someone asks to join my team', hint: 'Admins' }],
  },
];

/** The three Huddle team levels, in the order they're offered. */
export const HUDDLE_TEAM_LEVELS: Array<{
  level: HuddleTeamLevel;
  label: string;
  description: string;
}> = [
  { level: 'all', label: 'All posts', description: "Every update in this team's Huddle" },
  {
    level: 'mentions',
    label: 'Mentions & replies',
    description: 'Only when someone @mentions you',
  },
  { level: 'mute', label: 'Mute', description: 'No pop-ups, nothing under the bell' },
];

/** Notification defaults an organization or enterprise sets for its teams, with locks. */
export const NOTIFICATION_DEFAULT_ROWS: DefaultSettingRow[] = [
  {
    key: 'notifyAdminsOnClock',
    title: 'Tell team admins when a member clocks in or out',
    description:
      'Off sends no clock-in or clock-out alerts. Locked, admins cannot turn them off for themselves.',
    lockable: true,
  },
  {
    key: 'shiftEndReminders',
    title: 'Shift-end reminders',
    description:
      'Remind members to clock out as they near 8 hours. Locked, nobody can turn them off.',
    lockable: true,
  },
];

export const NOTIFICATION_STRINGS = {
  deliveryTitle: 'Where you get alerts',
  deliveryDescription:
    'Push is turned on for each device. Everything you are notified about is also logged under the bell.',
  eventsTitle: 'What notifies you',
  eventsDescription:
    'Tick where you want a pop-up. Anything ticked is also logged under the bell. Untick both to turn an event off.',
  eventColumn: 'Event',
  device: { desktop: 'Desktop', phone: 'Phone' } satisfies Record<NotificationDevice, string>,
  deviceTabsLabel: 'Settings for',
  cellLabel: (event: string, device: NotificationDevice) =>
    `${event}, ${NOTIFICATION_STRINGS.device[device]}`,
  thisDeviceDesktop: 'Desktop push in this browser',
  thisDevicePhone: 'Phone push on this device',
  thisDeviceHint: 'Allow pop-ups here. What pops up is chosen below.',
  teamsTitle: 'Huddle, per team',
  teamsDescription:
    "Choose how much of each team's Huddle reaches you. Also on the bell in a Huddle conversation.",
  teamsEmpty: 'You are not on any teams yet.',
  teamLevelLabel: (team: string) => `Huddle notifications for ${team}`,
  bellLabel: (team: string, level: string) => `Notifications for ${team}: ${level}`,
  bellHeading: (team: string) => `Notify me in ${team} about`,
  allSettings: 'Notification settings…',
  quietTitle: 'Quiet time',
  quietDescription: 'Holds pop-ups. Anything held is still logged under the bell.',
  holdOffShift: "Hold Huddle pop-ups while I'm clocked out",
  holdOffShiftHint: 'Mentions still come through.',
  snooze: 'Snooze all pop-ups',
  snoozeOptions: {
    off: 'Off',
    hour: '1 hour',
    tomorrow: 'Until tomorrow',
    clockIn: 'Until I clock in',
  },
  snoozeStatusOff: 'Pop-ups are on.',
  snoozeStatusUntil: (when: string) => `Paused until ${when}.`,
  snoozeStatusClockIn: 'Paused until you next clock in.',
  lockedByOrg: 'Set by your organization',
  loadFailed: 'Could not load your notification settings.',
  saveFailed: 'Could not save that change. Please try again.',
} as const;
