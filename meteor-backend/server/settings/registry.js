/**
 * The one place a setting is declared: its type, system default and the levels
 * it may be set at. No Meteor imports, so it is unit-testable.
 *
 * `personalExempt` settings resolve to `exemptValue` on a Personal team no
 * matter what a higher level says.
 */
export const SETTINGS = {
  requirePlanForClock: {
    type: 'boolean',
    default: true,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: true,
    exemptValue: false,
  },
  autoAcceptJoins: {
    type: 'boolean',
    default: false,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
  allowAutoJoin: {
    type: 'boolean',
    default: true,
    levels: ['enterprise', 'org'],
    personalExempt: false,
  },
  // Notifications (#784). Off means the notification isn't sent at all; a lock
  // also stops each person from turning it off for themselves.
  notifyAdminsOnClock: {
    type: 'boolean',
    default: true,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
  shiftEndReminders: {
    type: 'boolean',
    default: true,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
  // Pulse in the iPhone app, off unless a team, org or enterprise turns it on.
  // pulseInApp off hides the record buttons only: videos already on a phone still send.
  pulseInApp: {
    type: 'boolean',
    default: false,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
  // The clock page's "with a Pulse video" clock-in and clock-out buttons.
  pulseClockInOut: {
    type: 'boolean',
    default: false,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
  // Shared phones: unsent videos are deleted at sign-out instead of kept for the next sign-in.
  pulseSharedDevice: {
    type: 'boolean',
    default: false,
    levels: ['enterprise', 'org', 'team'],
    personalExempt: false,
  },
};

export const SETTING_KEYS = Object.keys(SETTINGS);
