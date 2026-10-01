/** Every key starts with the user id so two accounts on one device never share cached data. */
export const queryKeys = {
  huddleTeamPosts: (userId: string, teamId: string) =>
    ['huddle', 'teamPosts', userId, teamId] as const,
  huddleMyPosts: (userId: string) => ['huddle', 'myPosts', userId] as const,
  /** `teamIdsKey` is the sorted, comma-joined ids of every team whose tickets are listed. */
  tickets: (userId: string, teamIdsKey: string) => ['tickets', userId, teamIdsKey] as const,
};
