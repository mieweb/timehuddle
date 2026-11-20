import { fakeContractMaker, runPulseContract } from '@mieweb/pulse-embed/testing';
import { describe, expect, it } from 'vitest';

// Pulse's host contract, run inside Huddle's Vitest against the scripted fake
// TimeHuddle's own tests and pages use, so the vendored client this app
// installs is the one that passes it. fakeContractMaker() turns each test's
// setup into the fake's script (a server that never answers, a reload, the
// network), so every test the fake can arrange runs.
runPulseContract(fakeContractMaker(), { describe, it, expect });
