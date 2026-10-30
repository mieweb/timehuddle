/**
 * Unit tests for the unread-reminder job (server/unread-reminders.js), #784 M9:
 * what one run sends and what it queues next, and how starting and stopping
 * treat a queued job. Mongo, preferences and push are stubbed, and Agenda is a
 * fake that records what the module asks of it; the waits and the delivery
 * rule themselves are covered in notification-prefs-core.test.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const stub = vi.hoisted(() => ({
  unread: [] as number[],
  prefs: null as unknown,
  sendToUser: vi.fn(async () => {}),
}));

vi.mock('../server/collections', () => ({
  rawDb: () => ({
    collection: () => ({
      // Each count takes the next queued value, then repeats the last one.
      countDocuments: async () => (stub.unread.length > 1 ? stub.unread.shift() : stub.unread[0]),
    }),
  }),
}));
vi.mock('../server/notification-prefs', () => ({ getPrefs: async () => stub.prefs }));
vi.mock('../server/push', () => ({ sendToUser: stub.sendToUser }));

import { defineUnreadReminderJob, startUnreadReminders, stopUnreadRemindersIfAllRead } from '../server/unread-reminders';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-30T12:00:00Z');
const USER = 'user-1';
const ON = { events: { unreadReminder: { desktop: true } } };
const SNOOZED = { ...ON, quiet: { snoozeUntil: new Date(NOW.getTime() + HOUR) } };

/** What the module asked of Agenda. */
const agenda = {
  handler: null as null | ((job: unknown) => Promise<void>),
  created: [] as Array<{ data: unknown; unique: unknown; uniqueOpts: unknown; runAt: Date }>,
  cancelled: [] as unknown[],
  define(_name: string, handler: (job: unknown) => Promise<void>) {
    this.handler = handler;
  },
  create(_name: string, data: unknown) {
    const entry = { data, unique: null as unknown, uniqueOpts: null as unknown, runAt: new Date(0) };
    const builder = {
      unique(query: unknown, opts: unknown) {
        entry.unique = query;
        entry.uniqueOpts = opts;
        return builder;
      },
      schedule(at: Date) {
        entry.runAt = at;
        return builder;
      },
      save: async () => {
        agenda.created.push(entry);
      },
    };
    return builder;
  },
  async cancel(query: unknown) {
    this.cancelled.push(query);
  },
};

/** A job at `step`, recording whether the run removed it or queued it again. */
function jobAt(step: number) {
  const job = {
    attrs: { data: { userId: USER, step } },
    removed: false,
    runAt: null as Date | null,
    remove: async () => {
      job.removed = true;
    },
    schedule(at: Date) {
      job.runAt = at;
      return job;
    },
    save: async () => job,
  };
  return job;
}

async function run(step: number) {
  const job = jobAt(step);
  await agenda.handler!(job);
  return job;
}

beforeAll(() => {
  defineUnreadReminderJob(agenda);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  stub.unread = [3];
  stub.prefs = ON;
  stub.sendToUser.mockClear();
  agenda.created = [];
  agenda.cancelled = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a reminder run', () => {
  it('pushes the unread count to the chosen devices and queues the next one 4 hours out', async () => {
    const job = await run(0);
    expect(stub.sendToUser).toHaveBeenCalledTimes(1);
    expect(stub.sendToUser).toHaveBeenCalledWith(
      USER,
      {
        title: 'Huddle',
        body: 'You have 3 unread notifications.',
        tag: 'unread-reminder',
        data: { type: 'unread-reminder', url: '/app/notifications' },
      },
      expect.objectContaining({ desktop: true, phone: false }),
    );
    expect(job.removed).toBe(false);
    expect(job.attrs.data).toEqual({ userId: USER, step: 1 });
    expect(job.runAt).toEqual(new Date(NOW.getTime() + 4 * HOUR));
  });

  it('says "1 unread notification" for one', async () => {
    stub.unread = [1];
    await run(0);
    expect(stub.sendToUser).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ body: 'You have 1 unread notification.' }),
      expect.anything(),
    );
  });

  it('skips the push during a snooze but still moves on to the next wait', async () => {
    stub.prefs = SNOOZED;
    const job = await run(1);
    expect(stub.sendToUser).not.toHaveBeenCalled();
    expect(job.attrs.data.step).toBe(2);
    expect(job.runAt).toEqual(new Date(NOW.getTime() + 8 * HOUR));
  });

  it('sends the 32-hour reminder and then removes the job', async () => {
    const job = await run(4);
    expect(stub.sendToUser).toHaveBeenCalledTimes(1);
    expect(job.removed).toBe(true);
    expect(job.runAt).toBeNull();
  });

  it('removes the job without a push once nothing is unread', async () => {
    stub.unread = [0];
    const job = await run(2);
    expect(stub.sendToUser).not.toHaveBeenCalled();
    expect(job.removed).toBe(true);
    expect(agenda.created).toHaveLength(0);
  });

  it('starts again when a notification lands between its count and its removal', async () => {
    stub.unread = [0, 1, 1];
    const job = await run(2);
    expect(stub.sendToUser).not.toHaveBeenCalled();
    expect(job.removed).toBe(true);
    expect(agenda.created).toHaveLength(1);
    expect(agenda.created[0].data).toEqual({ userId: USER, step: 0 });
    expect(agenda.created[0].runAt).toEqual(new Date(NOW.getTime() + 2 * HOUR));
  });

  it('removes the job without a push once reminders are turned off', async () => {
    stub.prefs = { events: { unreadReminder: { desktop: false, phone: false } } };
    const job = await run(2);
    expect(stub.sendToUser).not.toHaveBeenCalled();
    expect(job.removed).toBe(true);
  });
});

describe('startUnreadReminders', () => {
  it('starts nothing while reminders are off', async () => {
    stub.prefs = null;
    await startUnreadReminders(USER);
    expect(agenda.created).toHaveLength(0);
  });

  it('queues step 0 two hours out, keeping a running job when other notifications are unread', async () => {
    stub.unread = [2];
    await startUnreadReminders(USER);
    expect(agenda.created).toEqual([
      {
        data: { userId: USER, step: 0 },
        unique: { name: 'unread-reminder', 'data.userId': USER },
        uniqueOpts: { insertOnly: true },
        runAt: new Date(NOW.getTime() + 2 * HOUR),
      },
    ]);
  });

  it('overwrites a leftover job when the new notification is the only unread one', async () => {
    stub.unread = [1];
    await startUnreadReminders(USER);
    expect(agenda.created[0].uniqueOpts).toEqual({ insertOnly: false });
  });
});

describe('stopUnreadRemindersIfAllRead', () => {
  it('keeps the job while anything is unread', async () => {
    stub.unread = [1];
    await stopUnreadRemindersIfAllRead(USER);
    expect(agenda.cancelled).toHaveLength(0);
  });

  it('cancels the job once nothing is unread', async () => {
    stub.unread = [0];
    await stopUnreadRemindersIfAllRead(USER);
    expect(agenda.cancelled).toEqual([{ name: 'unread-reminder', data: { userId: USER } }]);
    expect(agenda.created).toHaveLength(0);
  });

  it('starts again when a notification lands between the count and the cancel', async () => {
    stub.unread = [0, 1];
    await stopUnreadRemindersIfAllRead(USER);
    expect(agenda.cancelled).toHaveLength(1);
    expect(agenda.created).toHaveLength(1);
    expect(agenda.created[0].data).toEqual({ userId: USER, step: 0 });
  });
});
