/**
 * The app's minimal scrollbar, for `@mieweb/ui`'s `ScrollArea`.
 *
 * `ScrollArea`'s default `bg-border` thumb is too heavy in dark mode, so this
 * swaps in a light, theme-aware thumb matching the `.scrollbar-mieweb`
 * palette. It uses the same arbitrary variants as the component, so
 * tailwind-merge replaces them cleanly. Size the bar at the call site, e.g.
 * `[&::-webkit-scrollbar]:w-1.5` for a vertical one.
 */
export const MINIMAL_SCROLLBAR_CLASS =
  '[scrollbar-color:#d4d4d4_transparent] dark:[scrollbar-color:#404040_transparent] [&::-webkit-scrollbar-thumb]:bg-neutral-300 hover:[&::-webkit-scrollbar-thumb]:bg-neutral-400 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-700 dark:hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600';
