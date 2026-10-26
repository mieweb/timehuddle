// Build-time stand-in for prosemirror-dev-toolkit (see vite.config.ts). Kerebron's
// editor kit always registers its dev panel; opening it is a debugging aid only.
export const applyDevTools = (): void => {};
export const removeDevTools = (): void => {};
