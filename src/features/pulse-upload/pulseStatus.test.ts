import { describe, expect, it } from 'vitest';

import { keptMessage } from './pulseStatus';

describe('keptMessage', () => {
  it('says where the video went, with the reason as a sentence', () => {
    expect(keptMessage('That ticket was deleted.')).toBe(
      "Couldn't add your video here. That ticket was deleted. It's saved, not lost.",
    );
    expect(keptMessage('Not a team member')).toBe(
      "Couldn't add your video here. Not a team member. It's saved, not lost.",
    );
  });

  it('still makes sense without a reason', () => {
    expect(keptMessage()).toBe("Couldn't add your video here. It's saved, not lost.");
  });
});
