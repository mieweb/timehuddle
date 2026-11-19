/**
 * The one place TimeHuddle imports Pulse's host client (@mieweb/pulse-embed)
 * from. Pulse in the app is a native plugin (PulseKit) behind this client:
 * where there is none (a browser, an older app build), `getPulse()` still
 * answers, and reports itself unavailable, so callers fall back to the Pulse
 * link (startPulse.ts).
 *
 * Keeping the import here lets tests swap the client in one place, and keeps
 * the rest of the feature on the types it needs.
 */
export { CONTRACT, contextKey, getPulse, isPulseError } from '@mieweb/pulse-embed';
export type {
  ConfirmSendRequest,
  ConfirmSendResult,
  FlowResult,
  HostServiceError,
  HostServices,
  PulseClient,
  PulseContext,
  PulseInfo,
  ReleaseRequest,
  TokenRequest,
  TokenResult,
  UploadTarget,
  UploadTargetRequest,
  UploadTypeSpec,
} from '@mieweb/pulse-embed';
