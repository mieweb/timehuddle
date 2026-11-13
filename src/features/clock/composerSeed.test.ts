import { describe, expect, it, vi } from 'vitest';

import { ticketLine } from '../huddle/useTicketSelection';
import {
  offerComposerSeed,
  onComposerSeed,
  takeComposerSeed,
  ticketChecklist,
} from './composerSeed';

describe('composerSeed', () => {
  it('hands a seed over once', () => {
    offerComposerSeed({ markdown: '- [ ] TH-1 A' });
    expect(takeComposerSeed()?.markdown).toBe('- [ ] TH-1 A');
    expect(takeComposerSeed()).toBeNull();
  });

  it('tells an open composer when one arrives', () => {
    const listener = vi.fn();
    const stop = onComposerSeed(listener);
    offerComposerSeed({ markdown: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    takeComposerSeed();
  });

  it('writes tickets as a checklist, one per line', () => {
    expect(ticketChecklist(['TH-1 A', 'TH-2 B'])).toBe('- [ ] TH-1 A\n- [ ] TH-2 B');
  });
});

describe('ticketLine', () => {
  it('leads with the ID when known', () => {
    expect(ticketLine({ id: '1', title: 'Fix login', ref: 'TH-146' })).toBe('TH-146 Fix login');
    expect(ticketLine({ id: '1', title: 'Fix login' })).toBe('Fix login');
  });
});
