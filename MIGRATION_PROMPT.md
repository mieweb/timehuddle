# One-Shot Migration Prompt: Meteor 2 + Blaze → Meteor 3 + React + TypeScript + Tailwind 4 + @mieweb/ui

> **What this is:** A battle-tested prompt you can hand to an AI (or a person) to migrate a Meteor 2.x Blaze app to a modern Meteor 3.x + React 19 + TypeScript + Tailwind CSS 4 + `@mieweb/ui` stack — avoiding every pitfall discovered during the original multi-week migration.

---

## The Task

Migrate `timehuddle-old` (Meteor 2.1, Blaze templates, jQuery, raw HTML/CSS) into `timehuddle-new` (Meteor 3.5, React 19, TypeScript, Tailwind CSS 4, `@mieweb/ui` component library). The old app has: user auth, team management, time clock, ticket system, messaging, profile management, inbox/notifications, dashboard, and audit logging.

---

## Target Stack (exact versions that work together)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Meteor | 3.5-beta.4 |
| UI | React | 19.x |
| Language | TypeScript | 5.9.x |
| CSS | Tailwind CSS | 4.2.x |
| PostCSS | @tailwindcss/postcss | 0.x (Tailwind 4's plugin) |
| Components | @mieweb/ui | 0.2.x (linked via `file:../mie-ui`) |
| Bundler | Rspack | (Meteor's built-in, via `rspack` package) |

---

## Critical Lessons Learned (read ALL before writing ANY code)

### Lesson 1: Tailwind CSS 4 Tree-Shaking Will Hide Your Components

**Problem:** After installing `@mieweb/ui` and using its React components, you get black borders, missing backgrounds, broken layouts. Utility classes exist in the component source but Tailwind doesn't generate them.

**Root Cause:** Tailwind 4 only scans files it discovers via automatic content detection. `node_modules/` is excluded by default. Your `tailwind.config.cjs` `content` array is **ignored** by Tailwind 4's CSS-first engine — it's a leftover from Tailwind 3.

**Fix:** Add an `@source` directive in your CSS entry point:

```css
@source "../node_modules/@mieweb/ui/dist";
```

This tells Tailwind 4 to scan the library's compiled output for class names. Without this line, **every external component library will appear broken.**

### Lesson 2: PostCSS Config — Use the Tailwind 4 Plugin, Not the Tailwind 3 One

**Problem:** If you configure `postcss.config.cjs` with `tailwindcss` (the old plugin), nothing works. Tailwind 4 requires its own PostCSS plugin.

**Fix:**
```js
// postcss.config.cjs
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

**NOT** `tailwindcss: {}` — that's the Tailwind 3 plugin and will silently fail or produce wrong output.

### Lesson 3: @mieweb/ui Brand Imports — Use the Barrel, Not Subpaths

**Problem:** TypeScript errors when importing individual brand configs like `import { bluehiveBrand } from '@mieweb/ui/brands/bluehive'`. The subpath exports may not line up with what TypeScript expects.

**Fix:** Use the barrel import with lazy loader pattern:
```typescript
import { generateBrandCSS, brands } from '@mieweb/ui/brands';

// Lazy-load a brand config by key
const config = await brands['bluehive']();
const css = generateBrandCSS(config);
```

The `brands` object returns `() => Promise<BrandConfig>` for each brand — this also gives you code splitting for free.

### Lesson 4: Dark Mode — The Biggest Gotcha (CSS Variable Fallbacks)

**This one cost hours of debugging. Read carefully.**

**Problem:** You set up dark mode, the `dark:` utility classes exist (verified 299 rules generated), the toggle sets `data-theme="dark"` and `.dark` class on `<html>`, but the sidebar stays white and dark mode barely works. Only the `<body>` gets dark (from mie-ui's own internal CSS).

**Red Herring:** You might think `@custom-variant dark` is broken. It's not. The Tailwind dark variant IS generating rules correctly.

**Actual Root Cause:** Your `@theme inline` block maps Tailwind color tokens to `@mieweb/ui` CSS variables:
```css
--color-neutral-900: var(--mieweb-neutral-900);
```
But the brand CSS files (e.g., `bluehive.css`) only define `--mieweb-primary-*` and semantic tokens. They do **NOT** define `--mieweb-neutral-*`, `--mieweb-secondary-*`, `--mieweb-destructive-*`, `--mieweb-success-*`, `--mieweb-warning-*`, or `--mieweb-info-*` scales. Those `var()` calls resolve to **nothing** (transparent), so `dark:bg-neutral-900` renders as transparent.

**Fix:** Add CSS fallback values using Tailwind's standard palette to EVERY `var()` reference in `@theme inline`:

```css
--color-neutral-900: var(--mieweb-neutral-900, #171717);
```

The fallback (`#171717`) ensures colors work even when the brand CSS doesn't define that scale. If a brand DOES define `--mieweb-neutral-900`, the brand value wins. You need fallbacks for ALL six color scales: neutral, secondary, destructive, success, warning, info.

**Fallback palette values (Tailwind defaults):**

| Scale | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|-------|-----|------|------|------|------|------|------|------|------|------|------|
| neutral | #fafafa | #f5f5f5 | #e5e5e5 | #d4d4d4 | #a3a3a3 | #737373 | #525252 | #404040 | #262626 | #171717 | #0a0a0a |
| secondary | #f9fafb | #f3f4f6 | #e5e7eb | #d1d5db | #9ca3af | #6b7280 | #4b5563 | #374151 | #1f2937 | #111827 | #030712 |
| destructive | #fef2f2 | #fee2e2 | #fecaca | #fca5a5 | #f87171 | #ef4444 | #dc2626 | #b91c1c | #991b1b | #7f1d1d | #450a0a |
| success | #f0fdf4 | #dcfce7 | #bbf7d0 | #86efac | #4ade80 | #22c55e | #16a34a | #15803d | #166534 | #14532d | #052e16 |
| warning | #fffbeb | #fef3c7 | #fde68a | #fcd34d | #fbbf24 | #f59e0b | #d97706 | #b45309 | #92400e | #78350f | #451a03 |
| info | #f0f9ff | #e0f2fe | #bae6fd | #7dd3fc | #38bdf8 | #0ea5e9 | #0284c7 | #0369a1 | #075985 | #0c4a6e | #082f49 |

### Lesson 5: Dark Mode Variant — Use @custom-variant, Not Just tailwind.config darkMode

**Problem:** Tailwind 4's CSS-first config doesn't always respect `tailwind.config.cjs`'s `darkMode` setting the way Tailwind 3 did.

**Fix:** Define the dark variant explicitly in CSS **and** make `useTheme` set both the class and data attribute:

```css
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```

```typescript
function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');       // for Tailwind config compat
  root.setAttribute('data-theme', t);                // for @custom-variant
  localStorage.setItem(THEME_KEY, t);
}
```

Setting both `.dark` class AND `data-theme` attribute ensures compatibility whether dark mode is matched via the Tailwind config or the `@custom-variant` directive.

### Lesson 6: Meteor 3 Async API Changes

**Problem:** Meteor 3 makes many server-side APIs async that were sync in Meteor 2. `Meteor.userId()` inside a method, collection finds in methods, etc.

**Fix:** All Meteor methods must be `async`. Use `await` for:
- `Meteor.userId()` / `Meteor.user()`
- Collection operations: `find().fetchAsync()`, `insertAsync()`, `updateAsync()`, `removeAsync()`
- Any method calling another method

### Lesson 7: Use @mieweb/ui for ALL UI Elements

**Hard rule:** Never use raw `<button>`, `<input>`, `<select>`, `<table>`, or custom modal/card/badge markup. Always import from `@mieweb/ui`:

```typescript
import { Button, Input, Card, CardHeader, CardContent, Modal, Badge, Select, Table } from '@mieweb/ui';
```

This ensures consistent theming, dark mode support, and accessibility across the entire app.

---

## Architecture to Build

### Project Structure

```
timehuddle-new/
├── client/
│   ├── main.tsx          # React root render
│   └── styles.css        # Tailwind 4 entry (THE critical file)
├── server/
│   └── main.ts           # Feature imports
├── imports/
│   ├── features/         # Self-contained feature modules
│   │   ├── auth/         # Login/registration API + methods
│   │   ├── audit/        # Audit logging
│   │   ├── clock/        # Time clock + timesheet
│   │   ├── dashboard/    # Dashboard page
│   │   ├── inbox/        # Notifications
│   │   ├── messages/     # Chat/messaging
│   │   ├── profile/      # User profile
│   │   ├── teams/        # Team management
│   │   └── tickets/      # Ticket/task system
│   ├── lib/              # Shared utilities
│   │   ├── constants.ts  # App-wide constants, storage keys
│   │   ├── useTheme.ts   # Theme hook (light/dark)
│   │   ├── useBrand.ts   # Brand theme hook (7 brand themes)
│   │   └── useMethod.ts  # Meteor method wrapper hook
│   ├── startup/
│   │   └── server.ts     # Collection indexes, publications setup
│   └── ui/               # Layout components
│       ├── AppLayout.tsx  # Root shell (sidebar + header + routing)
│       ├── Sidebar.tsx    # Collapsible sidebar navigation
│       ├── AppHeader.tsx  # Top bar
│       ├── SettingsPage.tsx
│       ├── router.ts     # Simple context-based router
│       └── ThemeToggle.tsx
├── tailwind.config.cjs
├── postcss.config.cjs
└── rspack.config.js
```

### Feature Module Pattern

Each feature is self-contained. To add or remove a feature:
1. Add/remove the `import` in `server/main.ts`
2. Add/remove the route entry in `AppLayout.tsx`
3. The feature folder contains everything: collection, methods, publications, React pages

```typescript
// server/main.ts
import '../imports/features/auth/api';
import '../imports/features/clock/api';
// Remove a line = feature fully disabled
```

---

## The Three Critical Config Files (get these right FIRST)

### 1. `client/styles.css` — THE Most Important File

```css
@import '@mieweb/ui/brands/bluehive.css' layer(theme);
@import 'tailwindcss';
@source "../node_modules/@mieweb/ui/dist";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme inline {
  /* Primary — no fallbacks needed, brand CSS always defines these */
  --color-primary: var(--mieweb-primary-500);
  --color-primary-50: var(--mieweb-primary-50);
  --color-primary-100: var(--mieweb-primary-100);
  --color-primary-200: var(--mieweb-primary-200);
  --color-primary-300: var(--mieweb-primary-300);
  --color-primary-400: var(--mieweb-primary-400);
  --color-primary-500: var(--mieweb-primary-500);
  --color-primary-600: var(--mieweb-primary-600);
  --color-primary-700: var(--mieweb-primary-700);
  --color-primary-800: var(--mieweb-primary-800);
  --color-primary-900: var(--mieweb-primary-900);
  --color-primary-950: var(--mieweb-primary-950);
  --color-primary-foreground: var(--mieweb-primary-foreground, #ffffff);

  /* Secondary — MUST have fallbacks (brand CSS may not define these) */
  --color-secondary: var(--mieweb-secondary-500, #6b7280);
  --color-secondary-50: var(--mieweb-secondary-50, #f9fafb);
  --color-secondary-100: var(--mieweb-secondary-100, #f3f4f6);
  --color-secondary-200: var(--mieweb-secondary-200, #e5e7eb);
  --color-secondary-300: var(--mieweb-secondary-300, #d1d5db);
  --color-secondary-400: var(--mieweb-secondary-400, #9ca3af);
  --color-secondary-500: var(--mieweb-secondary-500, #6b7280);
  --color-secondary-600: var(--mieweb-secondary-600, #4b5563);
  --color-secondary-700: var(--mieweb-secondary-700, #374151);
  --color-secondary-800: var(--mieweb-secondary-800, #1f2937);
  --color-secondary-900: var(--mieweb-secondary-900, #111827);
  --color-secondary-950: var(--mieweb-secondary-950, #030712);
  --color-secondary-foreground: var(--mieweb-secondary-foreground, #ffffff);

  /* Neutral — MUST have fallbacks (brand CSS may not define these) */
  --color-neutral: var(--mieweb-neutral-500, #737373);
  --color-neutral-50: var(--mieweb-neutral-50, #fafafa);
  --color-neutral-100: var(--mieweb-neutral-100, #f5f5f5);
  --color-neutral-200: var(--mieweb-neutral-200, #e5e5e5);
  --color-neutral-300: var(--mieweb-neutral-300, #d4d4d4);
  --color-neutral-400: var(--mieweb-neutral-400, #a3a3a3);
  --color-neutral-500: var(--mieweb-neutral-500, #737373);
  --color-neutral-600: var(--mieweb-neutral-600, #525252);
  --color-neutral-700: var(--mieweb-neutral-700, #404040);
  --color-neutral-800: var(--mieweb-neutral-800, #262626);
  --color-neutral-900: var(--mieweb-neutral-900, #171717);
  --color-neutral-950: var(--mieweb-neutral-950, #0a0a0a);

  /* Destructive — MUST have fallbacks */
  --color-destructive: var(--mieweb-destructive, #ef4444);
  --color-destructive-50: var(--mieweb-destructive-50, #fef2f2);
  --color-destructive-100: var(--mieweb-destructive-100, #fee2e2);
  --color-destructive-200: var(--mieweb-destructive-200, #fecaca);
  --color-destructive-300: var(--mieweb-destructive-300, #fca5a5);
  --color-destructive-400: var(--mieweb-destructive-400, #f87171);
  --color-destructive-500: var(--mieweb-destructive-500, #ef4444);
  --color-destructive-600: var(--mieweb-destructive-600, #dc2626);
  --color-destructive-700: var(--mieweb-destructive-700, #b91c1c);
  --color-destructive-800: var(--mieweb-destructive-800, #991b1b);
  --color-destructive-900: var(--mieweb-destructive-900, #7f1d1d);
  --color-destructive-950: var(--mieweb-destructive-950, #450a0a);
  --color-destructive-foreground: var(--mieweb-destructive-foreground, #ffffff);

  /* Success — MUST have fallbacks */
  --color-success: var(--mieweb-success, #22c55e);
  --color-success-50: var(--mieweb-success-50, #f0fdf4);
  --color-success-100: var(--mieweb-success-100, #dcfce7);
  --color-success-200: var(--mieweb-success-200, #bbf7d0);
  --color-success-300: var(--mieweb-success-300, #86efac);
  --color-success-400: var(--mieweb-success-400, #4ade80);
  --color-success-500: var(--mieweb-success-500, #22c55e);
  --color-success-600: var(--mieweb-success-600, #16a34a);
  --color-success-700: var(--mieweb-success-700, #15803d);
  --color-success-800: var(--mieweb-success-800, #166534);
  --color-success-900: var(--mieweb-success-900, #14532d);
  --color-success-950: var(--mieweb-success-950, #052e16);
  --color-success-foreground: var(--mieweb-success-foreground, #ffffff);

  /* Warning — MUST have fallbacks */
  --color-warning: var(--mieweb-warning, #f59e0b);
  --color-warning-50: var(--mieweb-warning-50, #fffbeb);
  --color-warning-100: var(--mieweb-warning-100, #fef3c7);
  --color-warning-200: var(--mieweb-warning-200, #fde68a);
  --color-warning-300: var(--mieweb-warning-300, #fcd34d);
  --color-warning-400: var(--mieweb-warning-400, #fbbf24);
  --color-warning-500: var(--mieweb-warning-500, #f59e0b);
  --color-warning-600: var(--mieweb-warning-600, #d97706);
  --color-warning-700: var(--mieweb-warning-700, #b45309);
  --color-warning-800: var(--mieweb-warning-800, #92400e);
  --color-warning-900: var(--mieweb-warning-900, #78350f);
  --color-warning-950: var(--mieweb-warning-950, #451a03);
  --color-warning-foreground: var(--mieweb-warning-foreground, #ffffff);

  /* Info — MUST have fallbacks */
  --color-info: var(--mieweb-info, #0ea5e9);
  --color-info-50: var(--mieweb-info-50, #f0f9ff);
  --color-info-100: var(--mieweb-info-100, #e0f2fe);
  --color-info-200: var(--mieweb-info-200, #bae6fd);
  --color-info-300: var(--mieweb-info-300, #7dd3fc);
  --color-info-400: var(--mieweb-info-400, #38bdf8);
  --color-info-500: var(--mieweb-info-500, #0ea5e9);
  --color-info-600: var(--mieweb-info-600, #0284c7);
  --color-info-700: var(--mieweb-info-700, #0369a1);
  --color-info-800: var(--mieweb-info-800, #075985);
  --color-info-900: var(--mieweb-info-900, #0c4a6e);
  --color-info-950: var(--mieweb-info-950, #082f49);
  --color-info-foreground: var(--mieweb-info-foreground, #ffffff);

  /* Semantic tokens — with fallbacks */
  --color-border: var(--mieweb-border, #e5e7eb);
  --color-input: var(--mieweb-input, #e5e7eb);
  --color-ring: var(--mieweb-ring, #27aae1);
  --color-background: var(--mieweb-background, #ffffff);
  --color-foreground: var(--mieweb-foreground, #171717);
  --color-card: var(--mieweb-card, #ffffff);
  --color-card-foreground: var(--mieweb-card-foreground, #171717);
  --color-muted: var(--mieweb-muted, #f5f5f5);
  --color-muted-foreground: var(--mieweb-muted-foreground, #737373);

  --color-chart-1: var(--mieweb-chart-1);
  --color-chart-2: var(--mieweb-chart-2);
  --color-chart-3: var(--mieweb-chart-3);
  --color-chart-4: var(--mieweb-chart-4);
  --color-chart-5: var(--mieweb-chart-5);
}

body {
  @apply bg-neutral-50 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100;
}
```

### 2. `postcss.config.cjs`

```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

### 3. `tailwind.config.cjs`

```js
const { miewebUIPreset } = require('@mieweb/ui/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [miewebUIPreset],
  darkMode: ['class', '.dark &'],
  content: [
    './client/**/*.{js,ts,jsx,tsx,html}',
    './imports/**/*.{js,ts,jsx,tsx,html}',
    './node_modules/@mieweb/ui/dist/**/*.js',
  ],
  theme: { extend: {} },
  plugins: [],
};
```

> **Note:** The `content` array is partially redundant in Tailwind 4 (which uses automatic content detection), but keeping it doesn't hurt and provides a safety net.

---

## Key Hooks to Implement

### `useTheme.ts` — Dark/Light Mode

```typescript
import { useEffect, useState } from 'react';
import { THEME_KEY } from './constants';

export type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_KEY) as Theme | null;
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', t === 'dark');   // class-based compat
  root.setAttribute('data-theme', t);            // @custom-variant selector
  localStorage.setItem(THEME_KEY, t);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, setTheme, toggle } as const;
}
```

### `useBrand.ts` — Brand Theme Switching

```typescript
import { useCallback, useEffect, useState } from 'react';
import type { BrandConfig } from '@mieweb/ui';
import { generateBrandCSS, brands } from '@mieweb/ui/brands';
import { BRAND_KEY } from './constants';

export type BrandId = keyof typeof brands;

export interface BrandMeta { id: BrandId; label: string; emoji: string; }

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
const DEFAULT_BRAND: BrandId = 'bluehive';

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

export function useBrand() {
  const [brand, setBrandState] = useState<BrandId>(getInitialBrand);

  useEffect(() => {
    if (brand === DEFAULT_BRAND) {
      const el = document.getElementById(STYLE_ID);
      if (el) el.textContent = '';
      return;
    }
    brands[brand]().then((config) => {
      applyBrandCSS(generateBrandCSS(config));
    });
  }, [brand]);

  const setBrand = useCallback((id: BrandId) => {
    setBrandState(id);
    localStorage.setItem(BRAND_KEY, id);
  }, []);

  return { brand, setBrand } as const;
}
```

---

## Meteor Packages Required

```
meteor-base@1.5.2
mongo@2.3.0-beta350.4
react-meteor-data
static-html@1.5.0
typescript@5.9.3
es5-shim@4.8.1
shell-server@0.7.0
fetch@0.1.6
ecmascript@0.17.0
reload@1.3.2
tracker@1.3.4
accounts-base@3.2.1-beta350.4
accounts-password@3.0.4
email@3.1.2
standard-minifier-css@1.10.1
standard-minifier-js@3.2.0
dynamic-import@0.7.4
underscore
rspack@1.0.0
server-render@0.4.3
```

---

## Migration Order (do it in exactly this sequence)

1. **Scaffold the project** — `meteor create --release 3.5-beta.4 timehuddle-new --typescript --react`
2. **Install npm deps** — `npm install @mieweb/ui react@19 tailwindcss@4 @tailwindcss/postcss autoprefixer`
3. **Create the three critical config files** (styles.css, postcss.config.cjs, tailwind.config.cjs) — **copy them exactly from this document**
4. **Verify Tailwind works** — create a test component with `className="bg-primary-500 text-white p-4"`. If it renders correctly, the CSS pipeline is working.
5. **Set up shared utilities** — constants.ts, useTheme.ts, useBrand.ts, useMethod.ts
6. **Build the layout shell** — AppLayout, Sidebar, AppHeader, router
7. **Migrate features one at a time** — auth first (it gates everything), then each feature module
8. **Verify dark mode** — toggle dark mode, check that sidebar, cards, inputs all go dark. If anything stays white, check the neutral color fallbacks in styles.css.
9. **Verify brand switching** — switch to WebChart (orange), verify primary colors change. Toggle dark mode while on WebChart — both should work together.
10. **Run `npx tsc --noEmit`** — fix any remaining TypeScript errors

---

## Common Traps and How to Spot Them

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Black/missing borders on @mieweb/ui components | Tailwind tree-shaking | Add `@source` directive |
| Dark mode toggle does nothing | Missing `@custom-variant dark` | Add it to styles.css |
| Dark mode toggles but sidebar stays light | Missing neutral color fallbacks | Add fallback values to `@theme inline` |
| Brand switch has no effect | Wrong import path | Use barrel: `from '@mieweb/ui/brands'` |
| TypeScript errors on brand imports | Subpath resolution | Use barrel import, not individual subpaths |
| PostCSS does nothing | Wrong plugin | Use `@tailwindcss/postcss`, not `tailwindcss` |
| Meteor methods throw "userId is not a function" | Meteor 3 async APIs | Make methods async, await all server APIs |
| Collection operations hang | Meteor 3 async | Use `fetchAsync()`, `insertAsync()`, `updateAsync()` |
| `var()` resolves to transparent | No CSS variable defined | Add fallback value: `var(--token, #hex)` |

---

## Verification Checklist

- [ ] `@source` directive present in styles.css
- [ ] `@custom-variant dark` defined in styles.css
- [ ] ALL `var()` in `@theme inline` have fallback values (except primary, which brands always define)
- [ ] PostCSS uses `@tailwindcss/postcss` not `tailwindcss`
- [ ] `useTheme` sets both `.dark` class AND `data-theme` attribute
- [ ] All UI elements use `@mieweb/ui` imports (no raw HTML elements)
- [ ] All Meteor methods are `async`
- [ ] All collection operations use `*Async()` variants
- [ ] Brand switching works (test at least 2 brands)
- [ ] Dark mode works with non-default brand active
- [ ] `npx tsc --noEmit` passes clean
