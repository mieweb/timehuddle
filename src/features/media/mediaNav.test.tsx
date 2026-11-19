import type { PulseClient } from '@mieweb/pulse-embed';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BottomNav } from '../../ui/BottomNav';
import { RouterProvider } from '../../ui/router';
import { TopNav } from '../../ui/TopNav';
import { PULSE_EMBED_OFF, PulseEmbedContext, type PulseEmbed } from '../pulse-embed/usePulseEmbed';
import { mediaGate } from './mediaVisibility';
import { PLACES, draftAt } from './testRows';
import { clockActionOf, parseFilter, placeGroupOf, stableOrder } from './unsentRows';

function client(attention: Record<string, number>): Partial<PulseClient> {
  return {
    countDrafts: vi.fn(async () => attention),
    on: vi.fn(() => () => {}),
  };
}

function renderNav(embed: PulseEmbed) {
  window.history.replaceState(null, '', '/app/dashboard');
  return render(
    <RouterProvider>
      <PulseEmbedContext.Provider value={embed}>
        <TopNav />
        <BottomNav />
      </PulseEmbedContext.Provider>
    </RouterProvider>,
  );
}

const visible = (c: Partial<PulseClient>): PulseEmbed => ({
  ...PULSE_EMBED_OFF,
  status: 'ready',
  client: c as PulseClient,
  surfacesVisible: true,
});

describe('the Media nav entry', () => {
  afterEach(cleanup);

  it('is absent while the visibility rule is false', () => {
    renderNav({ ...visible(client({})), surfacesVisible: false });
    expect(screen.queryByRole('button', { name: /^Media/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('button', { name: /^Media/ })).toBeNull();
  });

  it('shows under the rule, with the attention count on it and on More', async () => {
    const c = client({ ticket: 1, clock: 1 });
    renderNav(visible(c));
    const top = await screen.findByRole('button', { name: 'Media, 2 videos need attention' });
    expect(top.textContent).toContain('2');
    expect(c.countDrafts).toHaveBeenCalledWith({
      by: 'contextKind',
      attentionOnly: true,
      states: ['failed', 'sent'],
    });
    const more = screen.getByRole('button', { name: 'More, 2 videos need attention' });
    fireEvent.click(more);
    expect(
      screen.getAllByRole('button', { name: 'Media, 2 videos need attention' }).length,
    ).toBeGreaterThan(1);
  });

  it('carries no badge when nothing needs attention', async () => {
    renderNav(visible(client({})));
    expect(await screen.findByRole('button', { name: 'Media' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
  });
});

describe('mediaGate', () => {
  const base = { status: 'ready' as const, surfacesVisible: false, usage: null, teams: null };
  it('renders under the rule, redirects without Pulse, and waits for both facts', () => {
    expect(mediaGate({ ...base, surfacesVisible: true })).toBe('render');
    expect(mediaGate({ ...base, status: 'off' })).toBe('redirect');
    expect(mediaGate({ ...base, status: 'unavailable' })).toBe('redirect');
    expect(mediaGate({ ...base, status: 'starting' })).toBe('wait');
    expect(mediaGate(base)).toBe('wait');
    expect(mediaGate({ ...base, teams: {} })).toBe('wait');
    const usage = { namespace: 'n', bytes: 0, drafts: 0, unsent: 0 } as PulseEmbed['usage'];
    expect(mediaGate({ ...base, usage })).toBe('wait');
    expect(mediaGate({ ...base, teams: {}, usage })).toBe('redirect');
  });
});

describe('unsentRows', () => {
  it('stableOrder keeps known rows in place and puts new ones on top', () => {
    expect(stableOrder([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(stableOrder(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(stableOrder(['a', 'b', 'c'], ['n', 'c', 'a'])).toEqual(['n', 'a', 'c']);
  });

  it('groups by the place a video was recorded for', () => {
    expect(placeGroupOf(PLACES.ticket.context)).toBe('ticket');
    expect(placeGroupOf(PLACES.session.context)).toBe('clock');
    expect(placeGroupOf({ kind: 'clock-plan' })).toBe('clock');
    expect(placeGroupOf(PLACES.post.context)).toBe('post');
    expect(placeGroupOf({ kind: 'library' })).toBe('library');
    expect(placeGroupOf(null)).toBe('other');
  });

  it('reads a filter, anything unknown as All', () => {
    expect(parseFilter('clock')).toBe('clock');
    expect(parseFilter('nope')).toBe('all');
    expect(parseFilter(null)).toBe('all');
  });

  it('names the clock action a clock video belongs to', () => {
    expect(clockActionOf(PLACES.wrapup.context)).toBe('out');
    expect(clockActionOf(PLACES.session.context)).toBeNull();
    expect(clockActionOf(draftAt(null, 'draft').context)).toBeNull();
  });
});
