import type { PulseClient, PulseInfo } from '@mieweb/pulse-embed';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ticket } from '../../lib/api';
import { PRE_PROMPT_SEEN_KEY } from '../pulse-embed/PermissionPrePrompt';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from '../pulse-embed/usePulseEmbed';
import { huddleSource } from './sources/huddleSource';
import { redmineSource } from './sources/redmineSource';
import type { TicketSourceContext } from './sources/types';
import { pulseTicketOf, TicketPulseButton } from './TicketPulseButton';

// In the app (Capacitor), where Pulse can run.
vi.mock('../../lib/device', () => ({ isNativeApp: () => true, isMobileBrowser: () => false }));

// The chip itself is PulseButton's; here only what the row tells it.
vi.mock('../pulse-upload/PulseButton', () => ({
  PulseButton: ({ prepare, ariaLabel }: { prepare?: boolean; ariaLabel: string }) => (
    <button aria-label={ariaLabel} data-prepare={String(prepare)} />
  ),
}));

/** Tell the row's observer where the row is: one entry per change, oldest first. */
let report: (...intersecting: boolean[]) => void = () => {};

const chip = () => screen.getByRole('button', { name: 'Record a video for Fix login with Pulse' });
const prepared = () => chip().getAttribute('data-prepare');

describe('TicketPulseButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = (...intersecting) =>
            act(() => callback(intersecting.map((isIntersecting) => ({ isIntersecting }))));
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('has a link prepared only once its row has stayed on screen a moment', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    expect(prepared()).toBe('false');

    report(true);
    act(() => vi.advanceTimersByTime(299));
    expect(prepared()).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(prepared()).toBe('true');

    // Gone the moment it leaves.
    report(false);
    expect(prepared()).toBe('false');
  });

  it('prepares nothing for a row flicked past', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    report(true);
    act(() => vi.advanceTimersByTime(200));
    report(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(prepared()).toBe('false');
  });

  it('goes by where the row is now when several changes arrive at once', () => {
    render(<TicketPulseButton ticketId="t1" title="Fix login" />);
    report(true, false);
    act(() => vi.advanceTimersByTime(1000));
    expect(prepared()).toBe('false');

    report(false, true);
    act(() => vi.advanceTimersByTime(300));
    expect(prepared()).toBe('true');
  });

  it('keeps its clicks from the row, which opens the ticket on one', () => {
    const openTicket = vi.fn();
    render(
      <div onClick={openTicket}>
        <TicketPulseButton ticketId="t1" title="Fix login" />
      </div>,
    );
    fireEvent.click(chip());
    expect(openTicket).not.toHaveBeenCalled();
  });
});

// ─── H5: every ticket takes a Pulse video ───────────────────────────────────

const TEAM = '5f0c0ffee0c0ffee0c0ffee0';
const ctx: TicketSourceContext = {
  userId: 'u1',
  teams: [{ id: TEAM, name: 'Platform', ticketPrefix: 'TH' }],
  resolveMemberName: () => null,
};

const huddleTicket = (over: Partial<Ticket>): Ticket => ({
  id: '64b7f00d64b7f00d64b7f00d',
  teamId: TEAM,
  title: 'Fix login',
  description: null,
  github: '',
  linkIsIssue: null,
  status: 'open',
  priority: null,
  createdBy: 'u1',
  assignedTo: [],
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  updatedAt: null,
  linkedIssue: null,
  ...over,
});

/** A ticket carried from a Redmine issue (#736): a TimeHuddle ticket linked to it. */
const redmineSourced = huddleSource.toUnified(
  huddleTicket({ id: '64b7f00d64b7f00d64b7f0aa', linkedIssue: { source: 'redmine', id: '482' } }),
  ctx,
);
/** A ticket for a GitHub issue (#874's carried issues): a TimeHuddle ticket with its link. */
const githubIssue = huddleSource.toUnified(
  huddleTicket({
    id: '64b7f00d64b7f00d64b7f0bb',
    github: 'https://github.com/mieweb/timehuddle/issues/873',
    linkIsIssue: true,
  }),
  ctx,
);
/** A Redmine issue on its own: an issue number, no TimeHuddle ticket. */
const bareRedmine = redmineSource.toUnified(
  {
    issue: {
      id: 482,
      subject: 'Login fails',
      project: null,
      status: null,
      assignedTo: null,
      priority: null,
      tracker: null,
      createdAt: null,
      updatedAt: null,
    },
    baseUrl: 'https://redmine.example.com',
  },
  ctx,
);

const pulseOn = (): PulseEmbed => ({
  ...PULSE_EMBED_OFF,
  status: 'ready',
  client: {} as PulseClient,
  info: {
    contract: { major: 1, minor: 0 },
    platform: 'ios',
    supported: true,
    capabilities: [],
  } as unknown as PulseInfo,
  runtimePaused: false,
  teams: { [TEAM]: { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false } },
  types: [{ id: 'ticket.video' } as NonNullable<PulseEmbed['types']>[number]],
  open: vi.fn(async () => null),
});

describe('pulseTicketOf (H5)', () => {
  it('takes a Redmine-sourced ticket: it is a TimeHuddle ticket linked to the issue', () => {
    expect(redmineSourced.linked?.sourceId).toBe('redmine');
    expect(pulseTicketOf(redmineSourced)).toEqual({
      ticketId: '64b7f00d64b7f00d64b7f0aa',
      teamId: TEAM,
    });
  });

  it('takes a GitHub-issue ticket', () => {
    expect(githubIssue.externalRef?.label).toBe('GitHub');
    expect(pulseTicketOf(githubIssue)).toEqual({
      ticketId: '64b7f00d64b7f00d64b7f0bb',
      teamId: TEAM,
    });
  });

  it('takes a plain TimeHuddle ticket', () => {
    const plain = huddleSource.toUnified(huddleTicket({}), ctx);
    expect(pulseTicketOf(plain)?.ticketId).toBe('64b7f00d64b7f00d64b7f00d');
  });

  it('has nowhere to put a video for a row that is no TimeHuddle ticket', () => {
    expect(pulseTicketOf(bareRedmine)).toBeNull();
  });
});

describe('TicketPulseButton with Pulse in the app', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const renderFor = (ticket: typeof redmineSourced, embed: PulseEmbed, onRow = vi.fn()) => {
    const target = pulseTicketOf(ticket)!;
    render(
      <PulseEmbedContext.Provider value={embed}>
        <div onClick={onRow}>
          <TicketPulseButton
            ticketId={target.ticketId}
            teamId={target.teamId}
            title={ticket.title}
          />
        </div>
      </PulseEmbedContext.Provider>,
    );
    return onRow;
  };

  it.each([
    ['a Redmine-sourced ticket', redmineSourced],
    ['a GitHub-issue ticket', githubIssue],
  ])(
    'shows the "Record with Pulse" glyph on %s, and records for that ticket',
    async (_, ticket) => {
      const embed = pulseOn();
      const onRow = renderFor(ticket, embed);
      const glyph = screen.getByRole('button', { name: 'Record with Pulse' });
      expect(screen.queryByRole('button', { name: /Record a video for/ })).toBeNull();

      await act(async () => {
        fireEvent.click(glyph);
      });
      expect(embed.open).toHaveBeenCalledWith({
        entry: 'record',
        context: expect.objectContaining({ key: `ticket:${pulseTicketOf(ticket)!.ticketId}` }),
      });
      // The row doesn't open its ticket under Pulse.
      expect(onRow).not.toHaveBeenCalled();
    },
  );

  it("keeps today's Pulse chip where the ticket's team has Pulse in the app off", () => {
    renderFor(redmineSourced, { ...pulseOn(), teams: {} });
    expect(screen.queryByRole('button', { name: 'Record with Pulse' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Record a video for Fix login with Pulse' }),
    ).toBeTruthy();
  });
});
