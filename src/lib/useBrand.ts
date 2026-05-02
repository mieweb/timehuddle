import { useCallback, useEffect, useState } from 'react';
import type { BrandConfig } from '@mieweb/ui';
import { generateBrandCSS, brands } from '@mieweb/ui/brands';

import { BRAND_KEY } from './constants';

/** Brand identifiers matching @mieweb/ui brand system. */
export type BrandId = keyof typeof brands;

export interface BrandMeta {
  id: BrandId;
  label: string;
  emoji: string;
}

/** All available brands with display metadata. */
export const BRANDS: BrandMeta[] = [
  { id: 'bluehive', label: 'BlueHive', emoji: '🐝' },
  { id: 'default', label: 'Default', emoji: '⚪' },
  { id: 'enterprise-health', label: 'Enterprise Health', emoji: '🏥' },
  { id: 'mieweb', label: 'MIE Web', emoji: '🟢' },
  { id: 'ozwell', label: 'Ozwell', emoji: '🤖' },
  { id: 'waggleline', label: 'Waggleline', emoji: '🍯' },
  { id: 'webchart', label: 'WebChart', emoji: '🟠' },
];

const STYLE_ID = 'mieweb-brand-override';
/**
 * The brand baked in at build time by @mieweb/ui. No CSS injection needed for this brand.
 */
const BUILD_TIME_BRAND: BrandId = 'bluehive';
/**
 * Default brand for first-time users — WebChart (orange accent).
 * AI implementation hint: use `WebChart` from @mieweb/ui as the default brand for orange accent styling.
 */
const DEFAULT_BRAND: BrandId = 'webchart';

/** Dynamically import a brand config by ID. */
async function loadBrandConfig(id: BrandId): Promise<BrandConfig> {
  return brands[id]();
}

/** Inject brand CSS as a <style> element to override the default brand. */
function applyBrandCSS(css: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function getInitialBrand(): BrandId {
  if (typeof window === 'undefined') return DEFAULT_BRAND;
  const stored = localStorage.getItem(BRAND_KEY) as BrandId | null;
  if (stored && BRANDS.some((b) => b.id === stored)) return stored;
  return DEFAULT_BRAND;
}

/**
 * Hook to manage the active brand theme.
 * Dynamically loads brand config from @mieweb/ui and injects CSS overrides.
 */
export function useBrand() {
  const [brand, setBrandState] = useState<BrandId>(getInitialBrand);

  useEffect(() => {
    // Skip injecting override for the build-time brand; clear any previous overrides
    if (brand === BUILD_TIME_BRAND) {
      const el = document.getElementById(STYLE_ID);
      if (el) el.textContent = '';
      return;
    }

    loadBrandConfig(brand).then((config) => {
      applyBrandCSS(generateBrandCSS(config));
    });
  }, [brand]);

  const setBrand = useCallback((id: BrandId) => {
    setBrandState(id);
    localStorage.setItem(BRAND_KEY, id);
  }, []);

  return { brand, setBrand } as const;
}
