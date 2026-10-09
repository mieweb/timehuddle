import type { Browser, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Sample = Record<string, number>;

/** Chrome DevTools throttling presets; `none` measures the raw connection. */
const NETWORK_PROFILES = {
  none: null,
  fast4g: {
    latency: 40,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  },
  slow4g: {
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
} as const;

export const RUNS = Number(process.env.PERF_RUNS ?? 3);
const NETWORK = (process.env.PERF_NETWORK ?? 'none') as keyof typeof NETWORK_PROFILES;

/** Fresh browser context = cold HTTP cache, no stored session. */
export async function newColdPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // LCP/CLS are only observable live; buffer them so they can be read after load.
  await page.addInitScript(() => {
    const vitals = { lcp: 0, cls: 0 };
    (window as unknown as { __vitals: typeof vitals }).__vitals = vitals;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
      }[]) {
        if (!entry.hadRecentInput) vitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  const profile = NETWORK_PROFILES[NETWORK];
  if (profile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile });
  }
  return page;
}

/** Page-load metrics in ms (sizes in KB), measured from navigation start. */
export async function collectLoadMetrics(page: Page): Promise<Sample> {
  await page.waitForLoadState('networkidle');
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const vitals = (window as unknown as { __vitals: { lcp: number; cls: number } }).__vitals;
    const isJs = (r: PerformanceResourceTiming) => /\.m?js(\?|$)/.test(r.name);
    const kb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
    return {
      ttfb: Math.round(nav.responseStart),
      fcp: Math.round(fcp),
      lcp: Math.round(vitals.lcp),
      cls: Math.round(vitals.cls * 1000) / 1000,
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      requests: resources.length + 1,
      transferKB: kb(nav.transferSize + resources.reduce((sum, r) => sum + r.transferSize, 0)),
      jsTransferKB: kb(resources.filter(isJs).reduce((sum, r) => sum + r.transferSize, 0)),
      jsDecodedKB: kb(resources.filter(isJs).reduce((sum, r) => sum + r.decodedBodySize, 0)),
    };
  });
}

/** ms since navigation start, read inside the page. */
export const sinceNavigationStart = (page: Page): Promise<number> =>
  page.evaluate(() => Math.round(performance.now()));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median of each metric across runs. */
export function summarize(samples: Sample[]): Sample {
  return Object.fromEntries(
    Object.keys(samples[0]).map((key) => [key, median(samples.map((s) => s[key]))]),
  );
}

/** Prints a median/min/max table and writes raw samples to results/<name>.json. */
export function report(name: string, samples: Sample[]): Sample {
  const summary = summarize(samples);
  const rows = Object.keys(summary).map((metric) => {
    const values = samples.map((s) => s[metric]);
    return { metric, median: summary[metric], min: Math.min(...values), max: Math.max(...values) };
  });
  console.log(`\n[perf] ${name}  (${samples.length} runs, network=${NETWORK})`);
  console.table(rows);

  const dir = process.env.PERF_RESULTS_DIR ?? path.join(__dirname, '..', 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({ name, network: NETWORK, runs: samples, summary }, null, 2),
  );
  return summary;
}
