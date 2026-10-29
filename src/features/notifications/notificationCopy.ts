// Every user-facing string for notification preferences (#784), in one place
// until the app has i18n. The event keys match meteor-backend's
// notification-prefs-core.js EVENTS; their order here is the order shown.

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
      { key: 'huddleReply', label: 'Replies to my posts', hint: 'Comments on an update I posted' },
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
  loadFailed: 'Could not load your notification settings.',
  saveFailed: 'Could not save that change. Please try again.',
} as const;
