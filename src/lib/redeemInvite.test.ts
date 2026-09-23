import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureInviteParams } from './inviteParams';
import { redeemPendingInvite, type InviteRedeemer } from './redeemInvite';

/** Put the app at `url` as a fresh page load would, snapshotting its params. */
function loadAt(url: string) {
  window.history.replaceState(null, '', url);
  captureInviteParams();
}

function redeemer(overrides: Partial<InviteRedeemer> = {}): InviteRedeemer {
  return {
    acceptTeamInvitation: vi.fn().mockResolvedValue(undefined),
    acceptOrgInvitation: vi.fn().mockResolvedValue(undefined),
    joinByLink: vi.fn().mockResolvedValue({ status: 'joined', team: { id: 'team1', name: 'Ops' } }),
    ...overrides,
  };
}

const TOKEN = 'a'.repeat(64);

beforeEach(() => {
  loadAt('/app');
  vi.clearAllMocks();
});

describe('redeemPendingInvite — from the URL', () => {
  it('does nothing when the visitor arrived with no invite', async () => {
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'idle' });
    expect(ddp.joinByLink).not.toHaveBeenCalled();
  });

  it('redeems a join link and reports the team joined', async () => {
    loadAt(`/app?join=${TOKEN}`);
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'joined', teamId: 'team1' });
    expect(ddp.joinByLink).toHaveBeenCalledWith(TOKEN);
  });

  it('reports a request when the team reviews its joiners', async () => {
    loadAt(`/app?join=${TOKEN}`);
    const ddp = redeemer({
      joinByLink: vi.fn().mockResolvedValue({ status: 'pending', request: { teamId: 'team1' } }),
    });
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'pending' });
  });

  it('surfaces why a link failed, in the words the server used', async () => {
    loadAt(`/app?join=${TOKEN}`);
    const ddp = redeemer({
      joinByLink: vi.fn().mockRejectedValue(new Error('This invitation has been revoked.')),
    });
    expect(await redeemPendingInvite(ddp, null)).toEqual({
      kind: 'error',
      message: 'This invitation has been revoked.',
    });
  });

  it('spends an invite only once, however often it is called', async () => {
    loadAt(`/app?join=${TOKEN}`);
    const ddp = redeemer();
    await redeemPendingInvite(ddp, null);
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'idle' });
    expect(ddp.joinByLink).toHaveBeenCalledTimes(1);
  });

  it('accepts an email invitation without sending anyone to the Teams page', async () => {
    loadAt(`/app?invite=${TOKEN}`);
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'handled' });
    expect(ddp.acceptTeamInvitation).toHaveBeenCalledWith(TOKEN);
  });

  it('stays quiet when an email invitation fails, as it always has', async () => {
    loadAt(`/app?invite=${TOKEN}`);
    const ddp = redeemer({
      acceptTeamInvitation: vi.fn().mockRejectedValue(new Error('This invitation has expired.')),
    });
    expect(await redeemPendingInvite(ddp, null)).toEqual({ kind: 'handled' });
  });
});

// A social sign-in leaves the page and returns through an OAuth redirect or a
// `timehuddle://auth` deep link, so the invite is not in the URL by the time a
// session exists — it is handed over separately. This is the path no
// end-to-end test can reach without a real identity provider.
describe('redeemPendingInvite — carried through a social sign-in', () => {
  it('redeems a join link handed over by the redirect', async () => {
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, { join: TOKEN })).toEqual({
      kind: 'joined',
      teamId: 'team1',
    });
    expect(ddp.joinByLink).toHaveBeenCalledWith(TOKEN);
  });

  it('redeems a team invitation handed over by the redirect', async () => {
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, { invite: TOKEN })).toEqual({ kind: 'handled' });
    expect(ddp.acceptTeamInvitation).toHaveBeenCalledWith(TOKEN);
  });

  it('redeems an organization invitation handed over by the redirect', async () => {
    const ddp = redeemer();
    expect(await redeemPendingInvite(ddp, { orgInvite: TOKEN })).toEqual({ kind: 'handled' });
    expect(ddp.acceptOrgInvitation).toHaveBeenCalledWith(TOKEN);
  });

  it('reports a failed link the same way as one opened directly', async () => {
    const ddp = redeemer({
      joinByLink: vi.fn().mockRejectedValue(new Error('This invitation has expired.')),
    });
    expect(await redeemPendingInvite(ddp, { join: TOKEN })).toEqual({
      kind: 'error',
      message: 'This invitation has expired.',
    });
  });

  it('prefers the URL when the visitor has both', async () => {
    const urlToken = 'b'.repeat(64);
    loadAt(`/app?join=${urlToken}`);
    const ddp = redeemer();
    await redeemPendingInvite(ddp, { join: TOKEN });
    expect(ddp.joinByLink).toHaveBeenCalledWith(urlToken);
    expect(ddp.joinByLink).toHaveBeenCalledTimes(1);
  });

  it('spends every token the visitor arrived with, not just the first', async () => {
    const ddp = redeemer();
    const outcome = await redeemPendingInvite(ddp, { join: TOKEN, orgInvite: TOKEN });
    expect(ddp.acceptOrgInvitation).toHaveBeenCalledWith(TOKEN);
    expect(ddp.joinByLink).toHaveBeenCalledWith(TOKEN);
    expect(outcome).toEqual({ kind: 'joined', teamId: 'team1' });
  });
});
