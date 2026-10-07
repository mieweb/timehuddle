import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type SafariAwareOrgChart = {
  isSafari?: () => boolean;
  render: () => unknown;
  exportSvg?: () => unknown;
  getChartState?: () => { svg?: { node: () => SVGSVGElement | null }; imageName?: string };
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
function forceHtmlOverlayOnIos(orgChart: SafariAwareOrgChart): void {
  if (Capacitor.getPlatform() !== 'ios') return;
  ensureOverlayPanStyle();
  orgChart.isSafari = () => true;
  orgChart.render();
}

export function serializeSvgForExport(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // The iOS overlay path hides these; the exported file has no overlay to show the text instead.
  clone
    .querySelectorAll<HTMLElement>('.node-foreign-object-div')
    .forEach((node) => (node.style.visibility = 'visible'));
  return `<?xml version="1.0" standalone="no"?>\r\n${new XMLSerializer().serializeToString(clone)}`;
}

// ychart saves via a <a download> data-URI click, which native WebViews ignore.
async function shareSvgFile(orgChart: SafariAwareOrgChart): Promise<void> {
  const state = orgChart.getChartState?.();
  const svg = state?.svg?.node();
  if (!svg) return;
  const fileName = `${state?.imageName ?? 'graph'}.svg`;
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: serializeSvgForExport(svg),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: fileName, files: [uri] });
}

function routeSvgExportToShareSheet(orgChart: SafariAwareOrgChart): void {
  if (!Capacitor.isNativePlatform()) return;
  orgChart.exportSvg = () => {
    shareSvgFile(orgChart).catch((error) => {
      // Dismissing the share sheet rejects on some platforms; only real failures matter.
      if (!/cancel/i.test(String(error))) console.error('[ychart] SVG export failed:', error);
    });
    return orgChart;
  };
}

export function patchYChartForCapacitor(orgChart: SafariAwareOrgChart | undefined): void {
  if (!orgChart) return;
  routeSvgExportToShareSheet(orgChart);
  forceHtmlOverlayOnIos(orgChart);
}
