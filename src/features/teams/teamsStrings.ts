// User-facing strings for the Teams page tabs, in one place until the app has i18n.
export const TEAMS_STRINGS = {
  tabs: {
    label: 'Team sections',
    members: 'Members',
    requests: (pending: number) => (pending > 0 ? `Requests (${pending})` : 'Requests'),
    invitations: 'Invitations',
    settings: 'Settings',
  },
  // Teams an organization owner manages without having joined.
  notJoined: 'Not joined',
  notJoinedHint:
    'You manage this team as an owner of the organization. Join it to clock in, post to its Huddle and track its work.',
  joinTeam: 'Join team',
  joinFailed: 'Failed to join team',
};
