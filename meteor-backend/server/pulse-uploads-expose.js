/**
 * The pulseUploads methods over REST and MCP: main.js calls
 * exposePulseUploads(Wormhole) once, after Wormhole.init, so every method is
 * reachable at `POST /api/<name with . as _>` (`/api/pulseUploads_begin`,
 * `/api/pulseUploadTypes_list`, …) with its schema. The methods themselves
 * are defined in pulse-uploads.js; the schemas and rate limits live in
 * pulse-uploads-expose-core.js.
 */
import { PULSE_UPLOAD_METHOD_MAP } from './pulse-uploads.js';
import { exposePulseUploads as exposeMethods } from './pulse-uploads-expose-core.js';

/** Expose every pulseUploads method through `wormhole`; returns their names. */
export function exposePulseUploads(wormhole) {
  return exposeMethods(wormhole, PULSE_UPLOAD_METHOD_MAP);
}
