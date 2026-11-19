import { createFakePulse, runPulseContract } from '@mieweb/pulse-embed/testing';
import { describe, expect, it } from 'vitest';

// Pulse's host contract, run inside Huddle's Vitest against the scripted fake
// TimeHuddle's own tests and pages use, so the vendored client this app
// installs is the one that passes it.
runPulseContract((setup) => createFakePulse(setup), { describe, it, expect });
