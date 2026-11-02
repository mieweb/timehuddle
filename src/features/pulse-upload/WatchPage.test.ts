import { describe, expect, it } from 'vitest';

import { watchPath } from './artifact';
import { watchPathVideoId } from './WatchPage';

describe('watchPathVideoId', () => {
  const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

  it("reads the video id back out of its page's path", () => {
    expect(watchPathVideoId(watchPath(VIDEO))).toBe(VIDEO);
    expect(watchPathVideoId(`/watch/${VIDEO}/`)).toBe(VIDEO);
  });

  it('is null for any other path', () => {
    for (const path of ['/watch', '/watch/', `/watch/${VIDEO}/more`, `/app/watch/${VIDEO}`, '/']) {
      expect(watchPathVideoId(path)).toBeNull();
    }
  });

  it("is null for an id that isn't a video's, so no other URL is played", () => {
    for (const path of ['/watch/%E0', '/watch/..%2F..%2Fapi%2Fx', '/watch/not-a-video']) {
      expect(watchPathVideoId(path)).toBeNull();
    }
    expect(watchPathVideoId(`/watch/${VIDEO.toUpperCase()}`)).toBe(VIDEO);
  });
});
