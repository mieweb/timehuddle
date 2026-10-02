/**
 * Stubs for the ticket-timer and My Board wormhole calls.
 *
 * The test backend has no Redmine, so a timer cannot really start on a Redmine
 * issue there. These answer the calls at the same boundary `stubRedmine` does,
 * and record what the page sent.
 */
import type { Page } from '@playwright/test';

type Body = Record<string, unknown>;

/** A wormhole success reply: the REST bridge wraps every answer in `{ result }`. */
export const jsonResult = (result: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ result }),
});

export interface BoardRef {
  sourceId: string;
  ticketId: string;
}

/** A My Board that keeps what is added to and removed from it, like the server. */
export async function stubMyBoard(page: Page, entries: BoardRef[] = []) {
  const board = [...entries];
  const adds: Body[] = [];
  const removals: Body[] = [];
  const sameAs = (ref: BoardRef) => (e: BoardRef) =>
    e.sourceId === ref.sourceId && e.ticketId === String(ref.ticketId);

  await page.route('**/api/myBoard_list', (route) =>
    route.fulfill(
      jsonResult({ entries: board.map((e) => ({ ...e, addedAt: '2026-09-01T00:00:00.000Z' })) }),
    ),
  );
  await page.route('**/api/myBoard_addMany', async (route) => {
    const body = route.request().postDataJSON();
    adds.push(body);
    for (const ref of body.refs ?? []) {
      if (!board.some(sameAs(ref))) {
        board.push({ sourceId: ref.sourceId, ticketId: String(ref.ticketId) });
      }
    }
    await route.fulfill(jsonResult({ addedCount: 1 }));
  });
  await page.route('**/api/myBoard_removeMany', async (route) => {
    const body = route.request().postDataJSON();
    removals.push(body);
    for (const ref of body.refs ?? []) {
      const at = board.findIndex(sameAs(ref));
      if (at >= 0) board.splice(at, 1);
    }
    await route.fulfill(jsonResult({ removedCount: 1 }));
  });
  return { board, adds, removals };
}

/**
 * Answer `timers.createEntry`, recording each request. `startError` refuses the
 * start with that error code; `onStart` runs when one succeeds.
 */
export async function stubTimerCreate(
  page: Page,
  { startError, onStart }: { startError?: string; onStart?: () => void } = {},
) {
  const starts: Body[] = [];
  await page.route('**/api/timers_createEntry', async (route) => {
    starts.push(route.request().postDataJSON());
    if (startError) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: startError, reason: startError }),
      });
      return;
    }
    onStart?.();
    await route.fulfill(jsonResult({ entry: { id: 'w1' }, session: { id: 's1' } }));
  });
  return starts;
}

/**
 * Answer `timers.getRunning` and `timers.getDay` for one Redmine issue, so the
 * page's own running-timer tracking sees a timer whenever `isRunning()` says so.
 */
export async function stubRunningTimer(
  page: Page,
  { ticketId, title, isRunning }: { ticketId: string; title: string; isRunning: () => boolean },
) {
  await page.route('**/api/timers_getRunning', (route) =>
    route.fulfill(
      jsonResult({
        session: isRunning()
          ? {
              id: 's1',
              workItemId: 'w1',
              userId: 'u',
              clockEventId: null,
              date: '2026-09-28',
              startTime: Date.now(),
              endTime: null,
              createdAt: '',
            }
          : null,
      }),
    ),
  );
  await page.route('**/api/timers_getDay', (route) =>
    route.fulfill(
      jsonResult({
        entries: [
          {
            entry: {
              id: 'w1',
              source: 'redmine',
              ticketId,
              displayTitle: title,
              displayUrl: null,
            },
            sessions: [],
          },
        ],
      }),
    ),
  );
}
