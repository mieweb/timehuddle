import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forceYChartHtmlOverlayOnIos } from './ychart';

function makeOrgChart() {
  return { isSafari: vi.fn(() => false), render: vi.fn() };
}

describe('forceYChartHtmlOverlayOnIos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forces the Safari overlay path and re-renders on iOS', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    const orgChart = makeOrgChart();

    forceYChartHtmlOverlayOnIos(orgChart);

    expect(orgChart.isSafari()).toBe(true);
    expect(orgChart.render).toHaveBeenCalledOnce();
  });

  it.each(['web', 'android'] as const)('leaves the chart untouched on %s', (platform) => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    const orgChart = makeOrgChart();

    forceYChartHtmlOverlayOnIos(orgChart);

    expect(orgChart.isSafari()).toBe(false);
    expect(orgChart.render).not.toHaveBeenCalled();
  });

  it('ignores a missing chart', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    expect(() => forceYChartHtmlOverlayOnIos(undefined)).not.toThrow();
  });
});
