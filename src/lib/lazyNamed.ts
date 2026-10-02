import { lazy, type ComponentType } from 'react';

/**
 * `React.lazy` for a module's named export — `React.lazy` itself only accepts
 * a default export, and the app's pages are named exports. Pass `'default'`
 * for a default export.
 *
 *   const DashboardPage = lazyNamed(() => import('./DashboardPage'), 'DashboardPage');
 *
 * Each load is logged, so the console shows which chunks a screen pulled in.
 */
export function lazyNamed<P extends object, K extends string>(
  load: () => Promise<Record<K, ComponentType<P>>>,
  name: K,
) {
  return lazy(() => {
    const start = performance.now();
    return load().then((module) => {
      const component = module[name];
      const label = name === 'default' ? component.displayName || component.name : name;
      console.log(
        `[TimeHuddle] lazy-loaded ${label} in ${(performance.now() - start).toFixed(0)}ms`,
      );
      return { default: component };
    });
  });
}
