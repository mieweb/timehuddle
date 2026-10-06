import { describe, expect, it } from 'vitest';

import { linkWarnings } from './linkWarnings';

const status = (
  myTime: Partial<{ unlinkedSeconds: number; unsentSeconds: number; sentSeconds: number }> = {},
  othersWithTime = 0,
) => ({
  myTime: { unlinkedSeconds: 0, unsentSeconds: 0, sentSeconds: 0, ...myTime },
  othersWithTime,
});

describe('linkWarnings', () => {
  it('says nothing when there is no time on the ticket', () => {
    expect(linkWarnings(status(), 'link', '')).toEqual([]);
    expect(linkWarnings(status(), 'unlink', '#482')).toEqual([]);
  });

  it('tells someone linking a ticket that time already logged stays in TimeHuddle', () => {
    const [warning, ...rest] = linkWarnings(status({ unlinkedSeconds: 3 * 3600 }), 'link', '');
    expect(warning).toMatch(/^You've already logged 3h 0m on this ticket\./);
    expect(rest).toEqual([]);
  });

  it('on unlink, says unsent time stays with the issue and sent time stays in Redmine', () => {
    const warnings = linkWarnings(
      status({ unsentSeconds: 8100, sentSeconds: 5400 }),
      'unlink',
      '#482',
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^2h 15m you logged .* hasn't been sent to Redmine #482 yet\./);
    expect(warnings[0]).toMatch(/It stays with #482/);
    expect(warnings[1]).toBe('1h 30m you already sent stays on Redmine #482.');
  });

  it('on relink, adds where time goes from now on', () => {
    const warnings = linkWarnings(status({ unsentSeconds: 600 }), 'relink', '#482');
    expect(warnings.at(-1)).toBe('Time you log from now on goes to the new issue.');
  });

  it('never mentions time logged before the link when the link is being changed', () => {
    expect(linkWarnings(status({ unlinkedSeconds: 3600 }), 'unlink', '#482')).toEqual([]);
  });

  it('says teammates will be notified, for any change', () => {
    expect(linkWarnings(status({}, 1), 'unlink', '#482')).toEqual([
      '1 teammate who logged time on this ticket will be notified.',
    ]);
    expect(linkWarnings(status({}, 3), 'link', '').at(-1)).toBe(
      '3 teammates who logged time on this ticket will be notified.',
    );
  });
});
