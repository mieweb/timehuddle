// User-facing strings for the Teams page tabs, in one place until the app has i18n.
export const TEAMS_STRINGS = {
  tabs: {
    label: 'Team sections',
    members: 'Members',
    requests: (pending: number) => (pending > 0 ? `Requests (${pending})` : 'Requests'),
    invitations: 'Invitations',
    settings: 'Settings',
  },
};
