/**
 * The pulseUploads methods over REST and MCP: main.js calls
 * exposePulseUploads(Wormhole) once, after Wormhole.init, so every method is
 * reachable at `POST /api/<name with . as _>` (`/api/pulseUploads_begin`,
 * `/api/pulseUploadTypes_list`, …) with its schema. The methods themselves
 * are defined in pulse-uploads.js; the schemas and rate limits live in
 * pulse-uploads-expose-core.js. The clock calls a Pulse video's Send makes
 * (`/api/clock_stopWithVideo`, `/api/clock_startWithPlan`) are defined in
 * pulse-clock.js, with their schemas in pulse-clock-core.js; importing it
 * here also loads it.
 */
import { PULSE_CLOCK_METHOD_MAP } from './pulse-clock.js';
import { PULSE_CLOCK_METHODS } from './pulse-clock-core.js';
import { PULSE_UPLOAD_METHOD_MAP } from './pulse-uploads.js';
import { exposePulseUploads as exposeMethods } from './pulse-uploads-expose-core.js';

/** Expose every pulseUploads method and the two clock calls through `wormhole`; returns their names. */
export function exposePulseUploads(wormhole) {
  return [
    ...exposeMethods(wormhole, PULSE_UPLOAD_METHOD_MAP),
    ...exposeMethods(wormhole, PULSE_CLOCK_METHOD_MAP, PULSE_CLOCK_METHODS),
  ];
}
