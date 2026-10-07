import { Capacitor } from '@capacitor/core';

type SafariAwareOrgChart = {
  isSafari?: () => boolean;
  render: () => unknown;
};

const PAN_STYLE_ID = 'ychart-overlay-touch-pan';

// The overlay cards sit above the SVG that owns d3-zoom's touch panning, so they must let touches
// through; only their buttons stay interactive.
const PAN_STYLE = `
@media (pointer: coarse) {
  .ychart-chart .html-overlay-container .overlay-node { pointer-events: none !important; }
  .ychart-chart .html-overlay-container .overlay-node .overlay-button,
  .ychart-chart .html-overlay-container .overlay-node .details-btn,
  .ychart-chart .html-overlay-container .overlay-node .expand-siblings-btn,
  .ychart-chart .html-overlay-container .overlay-node .expand-supervisor-chain-btn,
  .ychart-chart .html-overlay-container .overlay-node button,
  .ychart-chart .html-overlay-container .overlay-node a { pointer-events: auto !important; }
}`;

function ensureOverlayPanStyle(): void {
  if (document.getElementById(PAN_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PAN_STYLE_ID;
  style.textContent = PAN_STYLE;
  document.head.appendChild(style);
}

// ychart only switches to its HTML-overlay renderer when the UA contains "safari", which
// Capacitor's iOS WKWebView omits; its <foreignObject> nodes then render empty there.
export function forceYChartHtmlOverlayOnIos(orgChart: SafariAwareOrgChart | undefined): void {
  if (!orgChart || Capacitor.getPlatform() !== 'ios') return;
  ensureOverlayPanStyle();
  orgChart.isSafari = () => true;
  orgChart.render();
}
