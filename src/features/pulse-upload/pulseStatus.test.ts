import { describe, expect, it } from 'vitest';

import { followUpNote, keptMessage } from './pulseStatus';

describe('followUpNote', () => {
  it('shows a clock follow-up that differs from the landed label', () => {
    const plan = { kind: 'clock-plan', teamId: 't', postDate: '2026-01-01' } as const;
    expect(followUpNote(plan, "Plan posted — you're clocked in")).toBe('');
    expect(followUpNote(plan, "Plan posted, but you weren't clocked in.")).toBe(
      "Plan posted, but you weren't clocked in.",
    );
  });

  it('never shows backend notes for other kinds', () => {
    expect(followUpNote({ kind: 'ticket', id: 'abc' }, 'Attached to ticket abc')).toBe('');
    expect(followUpNote({ kind: 'library' }, 'Added to the media library')).toBe('');
    expect(
      followUpNote(
        { kind: 'timesheet-request', id: 'abc' },
        'Walkthrough added to the change request',
      ),
    ).toBe('');
  });
});

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
