// What a phone running Pulse does to a TimeHuddle backend, over plain HTTP:
// sign in (dev quick-login), reserve a link, read its token, upload.
// Shared by the scripts in this folder; see README.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The backend under test (Meteor's own port, not Vite's). */
export const BASE = (process.env.TH_BASE ?? 'http://localhost:3100').replace(/\/$/, '');
const VIDEO = fileURLToPath(new URL('../e2e/fixtures/test-video.mp4', import.meta.url));

/** Sign in as a dev quick-login role over DDP: `{ id, token }`, the token good as a REST bearer. */
export function devLogin(role = 'member') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/websocket`);
    const timer = setTimeout(
      () => reject(new Error(`No backend answered at ${BASE} within 15 s`)),
      15000,
    );
    const send = (message) => ws.send(JSON.stringify(message));
    ws.addEventListener('open', () => send({ msg: 'connect', version: '1', support: ['1'] }));
    ws.addEventListener('error', () => reject(new Error(`Can't reach a backend at ${BASE}`)));
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.msg === 'connected') {
        send({ msg: 'method', method: 'login', id: '1', params: [{ devQuickLogin: { role } }] });
      } else if (message.msg === 'ping') {
        send({ msg: 'pong' });
      } else if (message.msg === 'result' && message.id === '1') {
        clearTimeout(timer);
        ws.close();
        if (message.error)
          reject(new Error(`Dev quick-login failed: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      }
    });
  });
}

/** Call a Meteor method over Wormhole's REST (`teams.list` → `/api/teams_list`): `{ status, result, body }`. */
export async function callMethod(session, method, params = {}) {
  const res = await fetch(`${BASE}/api/${method.replace(/\./g, '_')}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, result: body.result, body };
}

/** A token's claims, unverified (the server verifies; this only reads); none for no token. */
export function claimsOf(token) {
  if (typeof token !== 'string') return {};
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

/** Upload the fixture video under `artifactId` over TUS, in one PATCH. */
export async function tusUpload(artifactId, token, name) {
  const bytes = fs.readFileSync(VIDEO);
  const field = (key, value) => `${key} ${Buffer.from(value).toString('base64')}`;
  const tus = { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${token}` };
  const created = await fetch(`${BASE}/pulsevault/upload`, {
    method: 'POST',
    headers: {
      ...tus,
      'Upload-Length': String(bytes.length),
      'Upload-Metadata': [
        field('artifactId', artifactId),
        field('filename', 'test-video.mp4'),
        ...(name ? [field('name', name)] : []),
      ].join(','),
    },
  });
  if (created.status !== 201)
    throw new Error(`TUS create ${created.status}: ${await created.text()}`);
  const patched = await fetch(new URL(created.headers.get('location'), BASE), {
    method: 'PATCH',
    headers: { ...tus, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    body: bytes,
  });
  if (patched.status !== 204)
    throw new Error(`TUS patch ${patched.status}: ${await patched.text()}`);
}

/** Wait until the host has said where an upload went: its outcome, `{ state: 'done' | 'kept', … }`. */
export async function waitFiled(artifactId, token, seconds = 120) {
  for (let waited = 0; waited < seconds; waited += 2) {
    const res = await fetch(`${BASE}/pulsevault/artifacts/${artifactId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { outcome } = await res.json().catch(() => ({}));
    if (outcome?.state === 'done' || outcome?.state === 'kept') return outcome;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${artifactId} wasn't filed within ${seconds} s`);
}

/** A run's checks: each prints as it goes, and `finish()` exits non-zero when any failed. */
export function checklist() {
  let failed = 0;
  return {
    section: (title) => console.log(`\n${title}`),
    check(what, ok, detail) {
      if (!ok) failed += 1;
      console.log(
        `  ${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`,
      );
      return ok;
    },
    skip: (what, why) => console.log(`  skip ${what} — ${why}`),
    finish() {
      console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
      process.exit(failed ? 1 : 0);
    },
  };
}
