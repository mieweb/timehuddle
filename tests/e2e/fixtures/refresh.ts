import { type Page } from '@playwright/test';

/**
 * Fire pull-to-refresh by dispatching a synthetic touch drag directly on the
 * PullToRefresh container. Dispatching real DOM TouchEvents on the element
 * that owns the listeners is far more reliable than CDP coordinate hit-tests
 * (the sticky header sits outside the gesture container).
 *
 * Pull-to-refresh only activates on touch-capable devices, so the page must
 * come from a `hasTouch` browser context.
 */
export async function pullToRefresh(p: Page): Promise<void> {
  await p.evaluate(() => {
    const el = document.querySelector('[data-testid="pull-to-refresh"]') as HTMLElement | null;
    if (!el) throw new Error('PullToRefresh container not found');
    const main = el.closest('main');
    if (main) main.scrollTop = 0;

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y0 = rect.top + 5;

    const event = (type: string, clientY: number): TouchEvent => {
      const touch = new Touch({
        identifier: 0,
        target: el,
        clientX: x,
        clientY,
        pageX: x,
        pageY: clientY,
      });
      const ended = type === 'touchend';
      return new TouchEvent(type, {
        cancelable: true,
        bubbles: true,
        touches: ended ? [] : [touch],
        targetTouches: ended ? [] : [touch],
        changedTouches: [touch],
      });
    };

    el.dispatchEvent(event('touchstart', y0));
    // Drag down past ACTIVATION_PX (15) and the release threshold (dy ≥ 75).
    for (let i = 1; i <= 10; i++) el.dispatchEvent(event('touchmove', y0 + i * 25));
    el.dispatchEvent(event('touchend', y0 + 250));
  });
}
