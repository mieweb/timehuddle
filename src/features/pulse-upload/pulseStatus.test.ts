import { describe, expect, it } from 'vitest';

import { keptMessage } from './pulseStatus';

describe('keptMessage', () => {
  it('says where the video went, with the reason as a sentence', () => {
    expect(keptMessage('That change has already been reviewed.')).toBe(
      "Couldn't add your video here. That change has already been reviewed. It's saved in your Media library.",
    );
    expect(keptMessage('Not a team member')).toBe(
      "Couldn't add your video here. Not a team member. It's saved in your Media library.",
    );
  });

  it('still makes sense without a reason', () => {
    expect(keptMessage()).toBe("Couldn't add your video here. It's saved in your Media library.");
  });
});
