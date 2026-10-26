---
applyTo: 'src/**/*.{ts,tsx}'
---

# Performance: Keep Heavy Libraries Out of Startup Downloads

Every page is its own lazily loaded chunk (`src/ui/AppLayout.tsx`). A static `import` puts the
imported code in that chunk, so it downloads every time the page opens — even if the part that
uses it only renders sometimes. The Clock page shipped the 860 KB rich-text editor on every visit
for months because it imported the editor statically to show it only when a plan was required
(fixed in PR #691).

## The Rule

**A heavy library is imported in exactly one wrapper component, and that wrapper is loaded with
`React.lazy`.** ESLint enforces both halves (`@typescript-eslint/no-restricted-imports` in
`eslint.config.mjs`); this file explains why.

| Library                                            | Wrapper (the only file that imports it)  | Loaded lazily by   |
| -------------------------------------------------- | ---------------------------------------- | ------------------ |
| `@mieweb/ui/kerebron` (rich-text editor)           | `src/features/huddle/MarkdownEditor.tsx` | `ClockPage`        |
| `@mieweb/ychart` (org chart)                       | `src/features/org/OrganizationChart.tsx` | `OrganizationPage` |
| `@mieweb/ui/datavis` (data grid)                   | `src/features/usage/UsageGrid.tsx`       | `OrgUsagePage`     |
| `mermaid`, other heavy `@mieweb/ui/*` entry points | none in use yet                          | —                  |

## When Writing Code

- **Using a library above:** render its wrapper, loaded like this — never `import { … } from` the
  wrapper or the library:

  ```tsx
  const MarkdownEditor = lazy(() =>
    import('../huddle/MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
  );
  // …
  <Suspense fallback={<Spinner />}>
    <MarkdownEditor … />
  </Suspense>
  ```

  `import type { … }` from either is fine: types ship no code.

- **Adding a heavy library:** check its chunk size in `npm run build` output. Anything around
  100 KB or more that only some screens need gets a wrapper file, an entry in the table above and
  in both lists of the `no-restricted-imports` rule.

- **Not everything needs this.** A library the page always shows (e.g. CodeMirror on the Seeder
  page) is already split by the page's own lazy chunk. The rule targets heavy code behind a
  condition: a mode, a tab, a dialog, a setting.

- **Don't silence the rule.** If it fires, either load the code lazily or add a new wrapper — not
  an `eslint-disable`.
