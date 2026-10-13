/**
 * Notifies members when a settings change turns the plan requirement on for
 * their team, whether the team set it itself or inherited it from above.
 */
import { createNotification } from '../notify-core';
import { announceSettingsChanged } from './changes';
import { idOf, reloadTeams, resolveSettingsForTeams } from './index';

export async function notifyPlanRequired(team, actorUserId) {
  const memberIds = Array.from(new Set([...team.members, ...team.admins])).filter(
    (id) => id !== actorUserId,
  );
  const teamId = idOf(team._id);
  const teamLabel = team.name ?? 'Your team';
  await Promise.allSettled(
    memberIds.map((memberId) =>
      createNotification({
        userId: memberId,
        title: `${teamLabel} now requires a plan before clocking in`,
        body: 'Write a short plan on the Clock In/Out page before starting your next shift.',
        data: { type: 'team-setting-change', url: '/app/clock', teamId },
      }),
    ),
  );
}

/**
 * Runs `write` and notifies each of `teams` whose resolved plan requirement
 * went from off to on. Teams that keep their own value resolve the same
 * before and after, so they are not notified.
 */
export async function writeNotifyingPlanChanges({ teams, actorUserId, write }) {
  const before = await resolveSettingsForTeams(teams);
  const result = await write();
  announceSettingsChanged();
  const after = await resolveSettingsForTeams(await reloadTeams(teams));
  const turnedOn = teams.filter(
    (_, i) => !before[i].requirePlanForClock.value && after[i].requirePlanForClock.value,
  );
  await Promise.all(turnedOn.map((team) => notifyPlanRequired(team, actorUserId)));
  return result;
}
