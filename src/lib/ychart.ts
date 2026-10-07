import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

type SafariAwareOrgChart = {
  isSafari?: () => boolean;
  render: () => unknown;
  exportSvg?: () => unknown;
  getChartState?: () => unknown;
};

type ExportChartState = { svg?: { node: () => SVGSVGElement | null }; imageName?: string };

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

const SVG_NS = 'http://www.w3.org/2000/svg';
const CARD_PADDING = 12;
const CHAR_WIDTH = 7;

type CardData = { name?: unknown; title?: unknown };

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(maxChars - 1, 1))}\u2026` : text;
}

function svgText(content: string, y: number, attrs: Record<string, string>): SVGTextElement {
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', String(CARD_PADDING));
  text.setAttribute('y', String(y));
  text.setAttribute('font-family', 'sans-serif');
  Object.entries(attrs).forEach(([name, value]) => text.setAttribute(name, value));
  text.textContent = content;
  return text;
}

// <foreignObject> HTML is positioned wrongly or dropped by most SVG viewers, so cards become plain text.
function buildCardText(data: CardData | undefined, width: number, height: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  const maxChars = Math.floor((width - CARD_PADDING * 2) / CHAR_WIDTH);
  const name = String(data?.name ?? '');
  const title = String(data?.title ?? '');
  group.appendChild(
    svgText(truncate(name, maxChars), height / 2 - 2, {
      'font-size': '13',
      'font-weight': '600',
      fill: '#111827',
    }),
  );
  if (title) {
    group.appendChild(
      svgText(truncate(title, maxChars), height / 2 + 16, { 'font-size': '11', fill: '#6b7280' }),
    );
  }
  return group;
}

export function serializeSvgForExport(svg: SVGSVGElement): string {
  const selector = '.node-foreign-object';
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const copies = clone.querySelectorAll(selector);
  // d3 keeps each node's datum on the live element; cloneNode drops it.
  svg.querySelectorAll(selector).forEach((card, index) => {
    const node = (card as unknown as { __data__?: { data?: CardData } }).__data__;
    const width = Number(card.getAttribute('width')) || 0;
    const height = Number(card.getAttribute('height')) || 0;
    copies[index]?.replaceWith(buildCardText(node?.data, width, height));
  });
  clone.querySelectorAll('foreignObject').forEach((node) => node.remove());

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#ffffff');
  clone.insertBefore(background, clone.firstChild);

  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return `<?xml version="1.0" standalone="no"?>\r\n${new XMLSerializer().serializeToString(clone)}`;
}

// ychart saves via a <a download> data-URI click, which native WebViews ignore.
async function shareSvgFile(orgChart: SafariAwareOrgChart): Promise<void> {
  const state = orgChart.getChartState?.() as ExportChartState | undefined;
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
