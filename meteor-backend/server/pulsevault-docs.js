/**
 * Hand-written OpenAPI 3.1 Path Item Objects for PulseVault's raw HTTP
 * surface (TUS upload + artifact serving). Wormhole's own `/api/openapi.json`
 * is generated purely from the Meteor-method registry, so these routes —
 * which aren't Meteor methods and can't be, since they carry binary
 * TUS/video bytes Wormhole's JSON-only REST bridge can't transport — are
 * contributed separately via the Wormhole plugin API's `addOpenApiPaths()`
 * (see `pulsevault.js`) and merged into the same spec served at `/api/docs`.
 *
 * Route shapes and response contracts are taken directly from
 * `@mieweb/pulsevault`'s `PROTOCOL.md` (the wire protocol the package
 * implements), not invented here.
 *
 * Each top-level Path Item carries its own `servers: [{ url: '' }]` override
 * — the merged spec's global `servers` points at Wormhole's REST base path
 * (`/api`), but these routes live at the document root under `/pulsevault`,
 * not under `/api`.
 */

const ERROR_RESPONSE_SCHEMA = {
  type: 'object',
  description: 'PulseVault protocol error shape (PROTOCOL.md §5.3).',
  properties: {
    ok: { type: 'boolean', const: false },
    error: { type: 'string' },
  },
  required: ['ok', 'error'],
};

const AUTH_HEADER_PARAM = {
  name: 'Authorization',
  in: 'header',
  required: true,
  description: 'Capability token: `Bearer <token>` (PROTOCOL.md §5.1).',
  schema: { type: 'string', example: 'Bearer <token>' },
};

const ARTIFACT_ID_PARAM = {
  name: 'artifactId',
  in: 'path',
  required: true,
  description: 'UUID minted by `pulsevault.reserve` / `pulsevault.reserveForLibrary`.',
  schema: { type: 'string', format: 'uuid' },
};

const UPLOAD_ID_PARAM = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The artifactId returned by `POST /pulsevault/upload`\'s `Location` header.',
  schema: { type: 'string', format: 'uuid' },
};

// Root-relative override so Swagger UI resolves these paths against the
// document root instead of the merged spec's global `/api` server.
const ROOT_SERVER = [{ url: '' }];

export const pulsevaultOpenApiPaths = {
  '/pulsevault/capabilities': {
    servers: ROOT_SERVER,
    get: {
      summary: 'PulseVault protocol capabilities discovery',
      description: 'Unauthenticated. Advertises upload limits and supported artifact kinds.',
      operationId: 'pulsevault_capabilities',
      tags: ['pulsevault'],
      responses: {
        200: {
          description: 'Capabilities payload (PROTOCOL.md §2)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  protocolVersion: { type: 'integer' },
                  minSupportedVersion: { type: 'integer' },
                  maxSupportedVersion: { type: 'integer' },
                  uploadUnit: { type: 'string', enum: ['segment', 'merged'] },
                  kinds: { type: 'array', items: { type: 'string' } },
                  allowedExtensions: { type: 'object' },
                  maxUploadSize: { type: 'integer', example: 524288000 },
                  checksum: {
                    type: 'object',
                    properties: { algorithms: { type: 'array', items: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/pulsevault/upload': {
    servers: ROOT_SERVER,
    post: {
      summary: 'Create a resumable upload (TUS creation)',
      description:
        'Standard TUS v1 creation request. `Upload-Metadata` must include `artifactId` ' +
        '(from `pulsevault.reserve`) and `filename`; `kind` defaults to `video`.',
      operationId: 'pulsevault_upload_create',
      tags: ['pulsevault'],
      parameters: [
        AUTH_HEADER_PARAM,
        {
          name: 'Upload-Length',
          in: 'header',
          required: true,
          schema: { type: 'integer' },
          description: 'Total upload size in bytes.',
        },
        {
          name: 'Upload-Metadata',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Comma-separated `<key> <base64(value)>` pairs (PROTOCOL.md §4.1).',
        },
        {
          name: 'Tus-Resumable',
          in: 'header',
          required: true,
          schema: { type: 'string', example: '1.0.0' },
        },
      ],
      responses: {
        201: {
          description: 'Upload created. `Location` header points at `/pulsevault/upload/<id>` for PATCH/HEAD/DELETE.',
          headers: {
            Location: { schema: { type: 'string' }, description: 'MUST be validated same-origin (PROTOCOL.md §4.3).' },
          },
        },
        401: { description: 'Missing credential', content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } } },
        403: { description: 'Invalid/expired token', content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } } },
      },
    },
  },
  '/pulsevault/upload/{id}': {
    servers: ROOT_SERVER,
    patch: {
      summary: 'Append a chunk at Upload-Offset',
      operationId: 'pulsevault_upload_patch',
      tags: ['pulsevault'],
      parameters: [
        UPLOAD_ID_PARAM,
        AUTH_HEADER_PARAM,
        { name: 'Upload-Offset', in: 'header', required: true, schema: { type: 'integer' } },
        { name: 'Tus-Resumable', in: 'header', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/offset+octet-stream': {
            schema: { type: 'string', format: 'binary', description: 'Raw bytes for this offset — never base64 or wrapped.' },
          },
        },
      },
      responses: {
        204: {
          description: 'Chunk accepted',
          headers: { 'Upload-Offset': { schema: { type: 'integer' } } },
        },
        409: {
          description: 'Offset mismatch — client MUST re-HEAD before resuming (PROTOCOL.md §4.2)',
          content: { 'application/json': { schema: ERROR_RESPONSE_SCHEMA } },
        },
      },
    },
    head: {
      summary: 'Query the current upload offset',
      operationId: 'pulsevault_upload_head',
      tags: ['pulsevault'],
      parameters: [UPLOAD_ID_PARAM, AUTH_HEADER_PARAM],
      responses: {
        200: {
          description: 'Authoritative offset — a client MUST use this rather than a locally cached count.',
          headers: {
            'Upload-Offset': { schema: { type: 'integer' } },
            'Upload-Length': { schema: { type: 'integer' } },
          },
        },
      },
    },
    delete: {
      summary: 'Cancel an in-flight upload',
      operationId: 'pulsevault_upload_delete',
      tags: ['pulsevault'],
      parameters: [UPLOAD_ID_PARAM, AUTH_HEADER_PARAM],
      responses: { 204: { description: 'Upload cancelled' } },
    },
  },
  '/pulsevault/artifacts/{artifactId}': {
    servers: ROOT_SERVER,
    get: {
      summary: 'Serve a finished artifact',
      description:
        'Public — no `Authorization` header required, though a `?token=` query param is ' +
        'accepted for deployments that choose to validate playback links (PROTOCOL.md §5.1).',
      operationId: 'pulsevault_artifact_get',
      tags: ['pulsevault'],
      parameters: [
        ARTIFACT_ID_PARAM,
        { name: 'token', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Artifact bytes, or a redirect to a URL serving them.',
          content: { 'video/mp4': { schema: { type: 'string', format: 'binary' } } },
        },
        404: {
          description: 'Not found, or upload not yet complete/validated (PROTOCOL.md §6.1) — never partial bytes.',
        },
      },
    },
    delete: {
      summary: 'Delete a finished artifact',
      operationId: 'pulsevault_artifact_delete',
      tags: ['pulsevault'],
      parameters: [ARTIFACT_ID_PARAM, AUTH_HEADER_PARAM],
      responses: { 204: { description: 'Artifact deleted' } },
    },
  },
};
