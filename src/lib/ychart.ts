import { Capacitor } from '@capacitor/core';

type SafariAwareOrgChart = {
  isSafari?: () => boolean;
  render: () => unknown;
};

// ychart only switches to its HTML-overlay renderer when the UA contains "safari", which
// Capacitor's iOS WKWebView omits; its <foreignObject> nodes then render empty there.
export function forceYChartHtmlOverlayOnIos(orgChart: SafariAwareOrgChart | undefined): void {
  if (!orgChart || Capacitor.getPlatform() !== 'ios') return;
  orgChart.isSafari = () => true;
  orgChart.render();
}
