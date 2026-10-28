/**
 * The account menu's sections. Both the avatar dropdown and the mobile More
 * sheet render these, so this pins what both show: Help, for everyone. Admin
 * and developer pages live in the main nav and in Settings now.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./AppLayout', () => ({ useAppFeedback: vi.fn() }));

import { buildAccountMenuSections } from './accountMenu';

const actions = { openReportIssue: vi.fn(), openFeedback: vi.fn(), openAppStore: vi.fn() };

describe('buildAccountMenuSections', () => {
  it('shows Help, and only Help', () => {
    expect(
      buildAccountMenuSections(actions).map((section) => [
        section.id,
        section.items.map((item) => item.label),
      ]),
    ).toEqual([['help', ['Report an Issue', 'Share Your Feedback', 'App Store']]]);
  });

  it('wires each Help item to its action', () => {
    const [help] = buildAccountMenuSections(actions);
    help.items.forEach((item) => item.onSelect());
    expect(actions.openReportIssue).toHaveBeenCalled();
    expect(actions.openFeedback).toHaveBeenCalled();
    expect(actions.openAppStore).toHaveBeenCalled();
  });
});
