import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { patchYChartForCapacitor, serializeSvgForExport } from './ychart';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn() },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn() } }));

function makeOrgChart(svg?: SVGSVGElement) {
  return {
    isSafari: vi.fn(() => false),
    render: vi.fn(),
    exportSvg: vi.fn(),
    getChartState: () => ({ svg: { node: () => svg ?? null }, imageName: 'org' }),
  };
}

function makeSvg(data: { name?: string; title?: string } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const card = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  card.setAttribute('class', 'node-foreign-object');
  card.setAttribute('width', '120');
  card.setAttribute('height', '60');
  (card as unknown as { __data__: unknown }).__data__ = {
    data: { name: 'Ada Lovelace', title: 'Admin', ...data },
  };
  svg.appendChild(card);
  return svg;
}

describe('patchYChartForCapacitor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forces the Safari overlay path and re-renders on iOS', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    const orgChart = makeOrgChart();

    patchYChartForCapacitor(orgChart);

    expect(orgChart.isSafari()).toBe(true);
    expect(orgChart.render).toHaveBeenCalledOnce();
  });

  it('injects the touch-pan style once on iOS', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');

    patchYChartForCapacitor(makeOrgChart());
    patchYChartForCapacitor(makeOrgChart());

    expect(document.querySelectorAll('#ychart-overlay-touch-pan')).toHaveLength(1);
  });

  it.each(['web', 'android'] as const)('leaves the overlay untouched on %s', (platform) => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
    const orgChart = makeOrgChart();

    patchYChartForCapacitor(orgChart);

    expect(orgChart.isSafari()).toBe(false);
    expect(orgChart.render).not.toHaveBeenCalled();
  });

  it('ignores a missing chart', () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    expect(() => patchYChartForCapacitor(undefined)).not.toThrow();
  });

  it('keeps the library export on the web', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const orgChart = makeOrgChart();
    const original = orgChart.exportSvg;

    patchYChartForCapacitor(orgChart);

    expect(orgChart.exportSvg).toBe(original);
  });

  it('shares the exported SVG as a file on native platforms', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'file:///cache/org.svg' });
    vi.mocked(Share.share).mockResolvedValue({ activityType: '' });
    const orgChart = makeOrgChart(makeSvg());

    patchYChartForCapacitor(orgChart);
    orgChart.exportSvg();

    await vi.waitFor(() => expect(Share.share).toHaveBeenCalled());
    expect(Filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'org.svg', directory: 'CACHE', encoding: 'utf8' }),
    );
    expect(Share.share).toHaveBeenCalledWith({
      title: 'org.svg',
      files: ['file:///cache/org.svg'],
    });
  });
});

describe('serializeSvgForExport', () => {
  it('replaces foreignObject cards with plain SVG text', () => {
    const source = serializeSvgForExport(makeSvg());

    expect(source).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(source).not.toContain('foreignObject');
    expect(source).toContain('>Ada Lovelace</text>');
    expect(source).toContain('>Admin</text>');
  });

  it('truncates names that do not fit the card', () => {
    const source = serializeSvgForExport(makeSvg({ name: 'A very long member name indeed' }));

    expect(source).toContain('\u2026</text>');
  });
});
