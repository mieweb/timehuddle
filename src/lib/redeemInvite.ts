/**
 * Redeeming the invite context a visitor arrived with, once they have a session.
 *
 * This lives apart from the entry point for two reasons. It is real logic —
 * which of three tokens to spend, in what order, and what the UI should say
 * afterwards — and it has to work for arrivals the URL cannot describe: a
 * social sign-in leaves the page entirely and comes back through an OAuth
 * redirect (web) or a `timehuddle://auth` deep link (native), carrying the
 * invite in `oauth` rather than in `window.location`.
 */
import { takeInviteParams } from './inviteParams';
import type { JoinLinkResult } from './ddp';

/** Invite context carried back through a social sign-in round trip. */
export interface PendingOAuthJoin {
  join?: string;
  invite?: string;
  orgInvite?: string;
}

/** Just the part of the DDP client redemption needs. */
export interface InviteRedeemer {
  acceptTeamInvitation(token: string): Promise<void>;
  acceptOrgInvitation(token: string): Promise<void>;
  joinByLink(value: string): Promise<JoinLinkResult>;
}

/**
 * `idle` means nothing was pending. `handled` means an email or organization
 * invitation was accepted, which leaves the person wherever they already were.
 * The rest are the `?join=` outcomes the Teams page reports.
 */
export type InviteOutcome =
  | { kind: 'idle' }
  | { kind: 'handled' }
  | { kind: 'joined'; teamId: string }
  | { kind: 'pending' }
  | { kind: 'error'; message: string };

export async function redeemPendingInvite(
  ddp: InviteRedeemer,
  oauth: PendingOAuthJoin | null,
): Promise<InviteOutcome> {
  // Claims the params, so the sign-in flow and this one can never both spend
  // the same token.
  const claimed = takeInviteParams();
  const join = claimed?.join ?? oauth?.join ?? null;
  const invite = claimed?.invite ?? oauth?.invite ?? null;
  const orgInvite = claimed?.orgInvite ?? oauth?.orgInvite ?? null;
  if (!join && !invite && !orgInvite) return { kind: 'idle' };

  try {
    if (invite) await ddp.acceptTeamInvitation(invite);
    if (orgInvite) await ddp.acceptOrgInvitation(orgInvite);
    if (!join) return { kind: 'handled' };

    const result = await ddp.joinByLink(join);
    return result.status === 'pending'
      ? { kind: 'pending' }
      : { kind: 'joined', teamId: result.team.id };
  } catch (err) {
    console.error('[invite] redeeming the invite failed:', err);
    // Only the `?join=` flow reports back; a failed email or organization
    // invitation stays as quiet as it always has.
    if (!join) return { kind: 'handled' };
    return {
      kind: 'error',
      message: (err as Error).message || 'This invite link is no longer valid.',
    };
  }
}
