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

const touchesPlanRequirement = (update) =>
  [...Object.keys(update.$set ?? {}), ...Object.keys(update.$unset ?? {})].some((key) =>
    key.endsWith('.requirePlanForClock'),
  );

/**
 * Runs `write` and notifies each team from `teams()` whose resolved plan
 * requirement went from off to on. Teams that keep their own value resolve the
 * same before and after, so they are not notified. Writes that leave the plan
 * requirement and its lock alone skip the before/after scan.
 */
export async function writeNotifyingPlanChanges({ update, teams, actorUserId, write }) {
  if (!touchesPlanRequirement(update)) {
    const result = await write();
    announceSettingsChanged();
    return result;
  }
  const affected = await teams();
  const before = await resolveSettingsForTeams(affected);
  const result = await write();
  announceSettingsChanged();
  const after = await resolveSettingsForTeams(await reloadTeams(affected));
  const turnedOn = affected.filter(
    (_, i) => !before[i].requirePlanForClock.value && after[i].requirePlanForClock.value,
  );
  await Promise.all(turnedOn.map((team) => notifyPlanRequired(team, actorUserId)));
  return result;
}
