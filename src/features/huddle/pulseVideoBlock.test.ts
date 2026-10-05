import { describe, expect, it } from 'vitest';

import { PULSE_VIDEO_WIDGET, pulseVideoMarkdown } from './pulseVideoBlock';

const VIDEO = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

describe('pulseVideoMarkdown', () => {
  it('keeps a title with backticks inside the fence, and reads it back intact', () => {
    const title = 'Demo ``` of the ```genui fence';
    const markdown = pulseVideoMarkdown(`/pulsevault/artifacts/${VIDEO}`, title)!;

    const lines = markdown.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('```genui');
    expect(lines[2]).toBe('```');
    expect(lines[1]).not.toContain('`');
    expect(JSON.parse(lines[1])).toEqual({
      widget: PULSE_VIDEO_WIDGET,
      props: { video: VIDEO, title },
    });
  });

  it('is null for anything that is not a PulseVault artifact', () => {
    expect(pulseVideoMarkdown('https://example.com/clip.mp4')).toBeNull();
  });
});
