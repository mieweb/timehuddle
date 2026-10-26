import { describe, expect, it } from 'vitest';

import { pulseArtifactId } from './artifact';

const ID = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';

describe('pulseArtifactId', () => {
  it('reads the id from a PulseVault artifact path or URL', () => {
    expect(pulseArtifactId(`/pulsevault/artifacts/${ID}`)).toBe(ID);
    expect(pulseArtifactId(`https://th.example/pulsevault/artifacts/${ID}?t=1`)).toBe(ID);
  });

  it('ignores a route that only appears in the query or deeper in the path', () => {
    expect(
      pulseArtifactId(`https://cdn.example/demo.mp4?source=/pulsevault/artifacts/${ID}`),
    ).toBeNull();
    expect(pulseArtifactId(`/proxy/pulsevault/artifacts/${ID}`)).toBeNull();
    expect(pulseArtifactId(`/pulsevault/artifacts/${ID}/poster`)).toBeNull();
  });

  it('refuses anything that is not a UUID, or no URL at all', () => {
    expect(pulseArtifactId('/pulsevault/artifacts/../../etc')).toBeNull();
    expect(pulseArtifactId(null)).toBeNull();
    expect(pulseArtifactId('')).toBeNull();
  });
});
