import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentedSwitcher } from './SegmentedSwitcher';

const OPTIONS = [
  { value: 'none', label: 'TimeHuddle only' },
  { value: 'github', label: 'GitHub' },
  { value: 'redmine', label: 'Redmine' },
] as const;

function renderSwitcher(value: (typeof OPTIONS)[number]['value'], onValueChange = vi.fn()) {
  render(
    <SegmentedSwitcher
      name="test"
      label="Tracked in"
      options={OPTIONS}
      value={value}
      onValueChange={onValueChange}
    />,
  );
  return onValueChange;
}

// jsdom has no matchMedia, which @mieweb/ui's Tooltip asks about reduced motion.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as MediaQueryList;

afterEach(cleanup);

describe('SegmentedSwitcher', () => {
  it('is a labelled radio group with exactly one option checked', () => {
    renderSwitcher('github');
    expect(screen.getByRole('radiogroup', { name: 'Tracked in' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'GitHub' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Redmine' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('keeps a single tab stop, on the selected option', () => {
    renderSwitcher('github');
    const tabStops = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0);
    expect(tabStops.map((radio) => radio.textContent)).toEqual(['GitHub']);
  });

  it('selects on click, and not again when it is already selected', () => {
    const onValueChange = renderSwitcher('github');
    fireEvent.click(screen.getByRole('radio', { name: 'Redmine' }));
    fireEvent.click(screen.getByRole('radio', { name: 'GitHub' }));
    expect(onValueChange.mock.calls).toEqual([['redmine']]);
  });

  it('moves the selection with the arrow keys, wrapping at the ends', () => {
    const onValueChange = renderSwitcher('redmine');
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onValueChange.mock.calls).toEqual([['none'], ['github']]);
  });

  it('names an icon-only option by its label, without showing the text', async () => {
    render(
      <SegmentedSwitcher
        name="views"
        label="View"
        hideLabel
        options={[
          { value: 'board', label: 'My Board' },
          { value: 'all', label: 'All Sources', icon: <svg data-testid="icon" />, iconOnly: true },
        ]}
        value="board"
        onValueChange={vi.fn()}
      />,
    );
    const iconOnly = screen.getByRole('radio', { name: 'All Sources' });
    expect(iconOnly.textContent).toBe('');
    // On a wide screen its name shows in a tooltip, on focus as well as hover.
    fireEvent.focus(iconOnly);
    expect((await screen.findByRole('tooltip', { hidden: true })).textContent).toBe('All Sources');
    expect(screen.getByTestId('icon')).toBeTruthy();
    // The group keeps its name with the visible label hidden.
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
  });

  it('shows no tooltip for an icon-only option on a phone', () => {
    const wide = window.matchMedia;
    window.matchMedia = (query: string) => ({ ...wide(query), matches: true }) as MediaQueryList;
    try {
      render(
        <SegmentedSwitcher
          name="views"
          label="View"
          hideLabel
          options={[
            { value: 'board', label: 'My Board' },
            { value: 'all', label: 'All Sources', icon: <svg />, iconOnly: true },
          ]}
          value="board"
          onValueChange={vi.fn()}
        />,
      );
      fireEvent.focus(screen.getByRole('radio', { name: 'All Sources' }));
      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    } finally {
      window.matchMedia = wide;
    }
  });

  it('shows an option\u2019s detail, colours it by tone, and takes its accessible name', () => {
    render(
      <SegmentedSwitcher
        name="shown"
        label="Tickets shown"
        hideLabel
        options={[
          {
            value: 'open',
            label: 'Open',
            detail: '12',
            accessibleName: 'Open tickets, 12',
            toneClassName: 'text-green-600',
          },
          {
            value: 'closed',
            label: 'Closed',
            detail: '50+',
            accessibleName: 'Closed tickets, 50+',
            toneClassName: 'text-purple-600',
          },
        ]}
        value="open"
        onValueChange={vi.fn()}
      />,
    );
    const open = screen.getByRole('radio', { name: 'Open tickets, 12' });
    const closed = screen.getByRole('radio', { name: 'Closed tickets, 50+' });
    expect(open.textContent).toBe('Open12');
    expect(open.className).toContain('text-green-600');
    // The one not chosen keeps its colour and is dimmed.
    expect(closed.className).toContain('text-purple-600');
    expect(closed.className).toContain('opacity-60');
    expect(open.className).not.toContain('opacity-60');
  });
});
