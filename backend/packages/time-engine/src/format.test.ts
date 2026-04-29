import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime,
  formatTimeFull,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatTimeRange,
  formatDuration,
  formatDurationClock,
  toLocalDateString,
  toUTCString,
  nowUTC,
} from './format.js';

// Use a fixed timezone so tests are deterministic regardless of machine location
const TZ = 'America/New_York';
const TZ_IST = 'Asia/Kolkata';

// 2026-03-20 09:00:00 UTC = 5:00 AM ET (EDT starts March 8, 2026)
const TS = Date.UTC(2026, 2, 20, 9, 0, 0);
// 2026-03-20 12:30:00 UTC = 8:30 AM ET
const TS_END = Date.UTC(2026, 2, 20, 12, 30, 0);

describe('formatTime', () => {
  it('formats time in a given timezone', () => {
    const result = formatTime(TS, TZ);
    assert.match(result, /5:00/); // 5:00 AM ET
  });

  it('formats time in a different timezone', () => {
    // 9:00 UTC = 2:30 PM IST
    const result = formatTime(TS, TZ_IST);
    assert.match(result, /2:30/);
  });
});

describe('formatTimeFull', () => {
  it('includes seconds', () => {
    const ts = Date.UTC(2026, 2, 20, 9, 0, 45);
    const result = formatTimeFull(ts, TZ);
    assert.match(result, /5:00:45/);
  });
});

describe('formatDate', () => {
  it('formats date in a given timezone', () => {
    const result = formatDate(TS, TZ);
    assert.match(result, /Mar/);
    assert.match(result, /20/);
    assert.match(result, /2026/);
  });
});

describe('formatDateShort', () => {
  it('formats short date without year', () => {
    const result = formatDateShort(TS, TZ);
    assert.match(result, /Mar/);
    assert.match(result, /20/);
    assert.ok(!result.includes('2026'));
  });
});

describe('formatDateTime', () => {
  it('includes both date and time', () => {
    const result = formatDateTime(TS, TZ);
    assert.match(result, /Mar/);
    assert.match(result, /20/);
    assert.match(result, /5:00/);
  });
});

describe('formatTimeRange', () => {
  it('formats a closed range', () => {
    const result = formatTimeRange(TS, TS_END, TZ);
    assert.match(result, /5:00/);   // start
    assert.match(result, /8:30/);   // end
    assert.match(result, /–/);       // en-dash separator
  });

  it('formats an open range (null end)', () => {
    const result = formatTimeRange(TS, null, TZ);
    assert.match(result, /5:00/);
    assert.match(result, /now/);
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    assert.equal(formatDuration(12_600_000), '3h 30m');  // 210 min
  });

  it('formats minutes only when < 1h', () => {
    assert.equal(formatDuration(900_000), '15m');
  });

  it('formats hours only when exact', () => {
    assert.equal(formatDuration(7_200_000), '2h');
  });

  it('formats zero', () => {
    assert.equal(formatDuration(0), '0m');
  });

  it('clamps negative to 0m', () => {
    assert.equal(formatDuration(-5000), '0m');
  });

  it('drops seconds (floors to minutes)', () => {
    assert.equal(formatDuration(45_000), '0m');   // 45 seconds → 0m
    assert.equal(formatDuration(90_000), '1m');   // 90 seconds → 1m
  });
});

describe('formatDurationClock', () => {
  it('formats as H:MM:SS', () => {
    assert.equal(formatDurationClock(12_600_000), '3:30:00');
  });

  it('formats under a minute', () => {
    assert.equal(formatDurationClock(75_000), '0:01:15');
  });

  it('formats zero', () => {
    assert.equal(formatDurationClock(0), '0:00:00');
  });

  it('pads minutes and seconds', () => {
    assert.equal(formatDurationClock(3_661_000), '1:01:01');
  });
});

describe('toLocalDateString', () => {
  it('returns YYYY-MM-DD in the given timezone', () => {
    assert.equal(toLocalDateString(TS, TZ), '2026-03-20');
  });

  it('respects timezone date boundary', () => {
    // 2026-03-20 23:00 UTC = 2026-03-21 04:30 IST
    const lateUTC = Date.UTC(2026, 2, 20, 23, 0, 0);
    assert.equal(toLocalDateString(lateUTC, 'UTC'), '2026-03-20');
    assert.equal(toLocalDateString(lateUTC, TZ_IST), '2026-03-21');
  });
});

describe('toUTCString', () => {
  it('returns ISO 8601 UTC string', () => {
    assert.equal(toUTCString(TS), '2026-03-20T09:00:00.000Z');
  });
});

describe('nowUTC', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now();
    const result = nowUTC();
    const after = Date.now();
    assert.ok(result >= before && result <= after);
  });
});
