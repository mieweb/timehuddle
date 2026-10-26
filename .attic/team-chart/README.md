# Archived Team Chart

**Archived on**: 2026-10-23

**Reason**: Unused since 2026-05-18, when the Teams page dropped its chart
(8df9b0c0, "Remove TeamChart from teams page…"). Nothing in `src/` imported it, so it
was already out of every bundle; it was moved here when a lint rule started refusing
static imports of `@mieweb/ychart` in `src/`.

## What Was Here

- `TeamChart.tsx` — a team org chart drawn with `@mieweb/ychart`, using
  `patchYChartForCapacitor` (`src/lib/ychart.ts`) so exports work in the native apps.

## If It Comes Back

The organization chart (`src/features/org/OrganizationChart.tsx`) is the live
equivalent and shows the pattern: it is the only file allowed to import
`@mieweb/ychart`, and `OrganizationPage` loads it with `React.lazy`. A revived team
chart should follow the same shape — see
`.github/instructions/performance.instructions.md`. Its `../../lib/ychart` import
would need to point back into `src/lib/` from wherever it lands.
