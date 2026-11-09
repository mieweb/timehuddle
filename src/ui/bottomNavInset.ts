/**
 * Room at the end of a scrolling list for the phone's fixed bottom nav and the
 * home indicator, as padding inside the list: for lists that run on under the
 * nav (a page that reserves it no room, `data-under-nav` in `AppLayout`).
 * A further 1rem keeps the last card off the nav once scrolled to the end.
 */
export const BOTTOM_NAV_INSET_CLASS =
  'max-md:pb-[calc(var(--bottom-nav-height)+max(env(safe-area-inset-bottom),0px)+1rem)]';
