/**
 * Client-side mirror of the server's timesheet approval policy, so the edit
 * form can demand a justification up front rather than letting someone fill in
 * a whole change and only then be told it needs one.
 *
 * The server in `timesheet-change-requests.js` remains the authority — it
 * rejects a submission that arrives without what it requires. Keep the two in
 * step.
 */
import type { Team } from './api';

/**
 * Who could sign off on this user's change. The user is excluded even when they
 * are an admin: approving your own edit is not review, and a team whose only
 * admin is the person editing would otherwise be permanently stuck.
 */
export function timesheetApproversFor(team: Team | null | undefined, userId: string): string[] {
  if (!team || team.isPersonal) return [];
  return team.admins.filter((id) => id !== userId);
}

/** Whether a retroactive change to this team's timesheet needs review. */
export function timesheetApprovalRequired(team: Team | null | undefined, userId: string): boolean {
  return timesheetApproversFor(team, userId).length > 0;
}

/** Only adding brand-new time needs a video; editing or deleting is explained in writing alone. */
export function timesheetVideoRequired(action: 'create' | 'update' | 'delete'): boolean {
  return action === 'create';
}

export const TIMESHEET_DESCRIPTION_MIN = 10;
