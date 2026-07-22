/**
 * TimeHuddle Meteor backend (Phase 1 PoC).
 *
 * - DDP publications give reactive Tickets + Clock data (oplog-backed, shared
 *   Mongo with the Fastify backend).
 * - meteor-wormhole exposes the methods below as REST (/api, Swagger at
 *   /api/docs) and MCP tools (/mcp) for AI agents.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { WebApp } from 'meteor/webapp';
import { Wormhole } from 'meteor/wreiske:meteor-wormhole';
import { ServiceConfiguration } from 'meteor/service-configuration';
import { OAuth } from 'meteor/oauth';
import { Random } from 'meteor/random';
import { Accounts } from 'meteor/accounts-base';

import { buildMailUrl } from './mail-url';
import './collections';
import './migration-login-handler';
import { rawDb } from './collections';
import './auth-bridge';
import { signProxyJwt, findOrCreateUser, resolveToken } from './auth-bridge';
import './tickets';
import './clock';
import './timers';
import './timers';
import './notifications';
import './presence';
import './activity';
// M2 — Collaboration
import './channels'; // must precede teams (teams.create calls ensureDefaultChannel)
import './teams';
import './team-join-requests';

// PulseVault — video upload + serving
import './pulsevault';
import './messages';
import './huddle';
// M3 — Org & profiles
import './users';
import './organizations';
import './enterprises';
import './tokens';
// M4 — HTTP-native surfaces
import './attachments';
import './uploads';
// M0.e foundations — built/validated now, consumed by M1 clock + notifications.
import './email';
import './push';
import { initAgenda } from './agenda';
import { bearerContextMiddleware } from './bearer-context';

/**
 * CORS for ALL routes — the Vite frontend on another origin calls both DDP and
 * HTTP endpoints. Global middleware catches everything before any other handlers.
 *
 * CORS_ORIGINS: comma-separated list of allowed origins, or '*' for all.
 * If unset, falls back to origins sharing the same base domain as ROOT_URL
 * (handles PR preview deployments where env vars may not propagate).
 */
const _rawCorsOrigins = process.env.CORS_ORIGINS || '';
const CORS_ALLOW_ALL = _rawCorsOrigins === '*';
const ALLOWED_ORIGINS = _rawCorsOrigins
  ? _rawCorsOrigins.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

// Hardcoded preview base domain — all MIEWeb Proxmox previews live here.
// This guarantees CORS works for PR previews even if env vars are not injected.
const PREVIEW_BASE_DOMAINS = ['os.mieweb.org'];

// Optionally derive an additional base domain from ROOT_URL
const _rootUrl = process.env.ROOT_URL || '';
const _rootHostname = (() => {
  try { return new URL(_rootUrl).hostname; } catch { return ''; }
})();
// Use all suffix components (e.g. os.mieweb.org) not just the last 2
// to avoid accidentally allowing all of mieweb.org
const _baseDomain = _rootHostname.includes('.')
  ? _rootHostname.split('.').slice(-3).join('.')  // last 3 parts: os.mieweb.org
  : '';

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (CORS_ALLOW_ALL) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    // Allow hardcoded preview base domains
    for (const base of PREVIEW_BASE_DOMAINS) {
      if (h === base || h.endsWith('.' + base)) return true;
    }
    // Allow same base domain as ROOT_URL (non-localhost)
    if (_baseDomain && _baseDomain !== 'localhost') {
      if (h === _baseDomain || h.endsWith('.' + _baseDomain)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

console.log('[cors] CORS_ORIGINS:', _rawCorsOrigins || '(not set)', '| ROOT_URL base domain:', _baseDomain || '(none)');

// Global CORS — catches ALL routes (DDP, /api, /uploads, etc.)
// EXCEPT /uploads/tus which handles its own protocol-specific OPTIONS
WebApp.rawConnectHandlers.use((req, res, next) => {
  // Skip TUS endpoints — they handle their own OPTIONS with protocol headers
  if (req.url?.startsWith('/uploads/tus')) {
    return next();
  }

  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
    // Includes the TUS resumable-upload protocol headers (@mieweb/pulsevault's
    // /pulsevault/upload route) — tus-js-client sends Tus-Resumable on every
    // request, so without it here the browser blocks the preflight before the
    // upload ever reaches the handler.
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Upload-Concat, Upload-Defer-Length',
    );
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Location, Upload-Offset, Upload-Length, Tus-Resumable, Tus-Version, Tus-Max-Size, Tus-Extension',
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

// Bearer token context — must be registered BEFORE wormhole REST bridge
WebApp.connectHandlers.use('/api', bearerContextMiddleware);
WebApp.connectHandlers.use('/mcp', bearerContextMiddleware);

// Root endpoint — identifies the server as Meteor backend
WebApp.connectHandlers.use('/', (req, res, next) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: 'timehuddle-meteor-backend', status: 'ok' }));
  } else {
    next();
  }
});

// Health check endpoint for deployment smoke tests
WebApp.connectHandlers.use('/health', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
});

// Proxy JWT endpoints - both /api/whoami and /auth/whoami for compatibility
const proxyWhoamiHandler = async (req, res) => {
  if (!process.env.PROXY_JWT_SECRET) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'PROXY_JWT_SECRET not configured' }));
    return;
  }

  let email, name;

  // Path 1: SSO proxy headers (Authentik/nginx)
  if (process.env.TRUST_PROXY_HEADERS === 'true' && req.headers['x-email']) {
    email = req.headers['x-email'];
    const firstName = req.headers['x-user-first-name'] || '';
    const lastName = req.headers['x-user-last-name'] || '';
    name = `${firstName} ${lastName}`.trim() || email;
  }

  // Path 2: Meteor resume token or PAT (Authorization header)
  if (!email) {
    const authHeader = req.headers['authorization'] || '';
    let bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken) {
      const db = rawDb();
      // Only check PAT/Meteor resume tokens (all users now in Meteor users collection)
      const identity = await resolveToken(bearerToken);
      if (identity) {
        const uid = String(identity.userId);
        const userDoc = await db.collection('users').findOne(
          { _id: uid },
          { projection: { emails: 1, profile: 1 } }
        );
        email = userDoc?.emails?.[0]?.address ?? identity.userId;
        name = userDoc?.profile?.name ?? identity.name ?? email;
      }
    }
  }

  if (!email) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'No proxy identity headers' }));
    return;
  }

  try {
    const token = await signProxyJwt(email, name);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ token }));
  } catch (err) {
    console.error('[/api/whoami] failed:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Failed to sign token' }));
  }
};

WebApp.connectHandlers.use('/api/whoami', proxyWhoamiHandler);

// ============================================================================
// GitHub OAuth Endpoints
// ============================================================================

WebApp.connectHandlers.use('/auth/github', (req, res, next) => {
  // Only handle exact /auth/github route, not /auth/github/callback
  if (req.url !== '/' && req.url !== '') { next(); return; }
  const credentialToken = Random.secret();
  const callbackUrl = `${process.env.ROOT_URL}/auth/github/callback`;
  
  console.log('[github-oauth] Initiating OAuth flow');
  console.log('[github-oauth] Client ID:', process.env.GITHUB_CLIENT_ID);
  console.log('[github-oauth] Callback URL:', callbackUrl);
  
  const githubAuthUrl =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=user:email` +
    `&state=${credentialToken}`;
  
  console.log('[github-oauth] Full auth URL:', githubAuthUrl);
  
  res.writeHead(302, { Location: githubAuthUrl });
  res.end();
});

WebApp.connectHandlers.use('/auth/github/callback', async (req, res) => {
  const { code, state } = Object.fromEntries(
    new URL(req.url, process.env.ROOT_URL).searchParams
  );
  
  if (!code) {
    res.writeHead(400);
    res.end('Missing code');
    return;
  }
  
  try {
    // Exchange code for token
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      }
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    
    // Get user info from GitHub
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const githubUser = await userRes.json();
    
    // Get user email
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const emails = await emailRes.json();
    const primaryEmail =
      emails.find((e) => e.primary && e.verified)?.email || githubUser.email;
    
    if (!primaryEmail) {
      res.writeHead(400);
      res.end('No email found');
      return;
    }
    
    // Find or create user in Meteor
    const userId = await findOrCreateUser(
      primaryEmail,
      githubUser.name || githubUser.login
    );
    
    // Create Meteor login token for this user
    const stampedToken = Accounts._generateStampedLoginToken();
    await Accounts._insertLoginToken(userId, stampedToken);
    
    // Sign a short-lived JWT for the frontend
    const { SignJWT } = await import('jose');
    
    // Use PROXY_JWT_SECRET for OAuth JWT signing
    const secret = new TextEncoder().encode(
      process.env.PROXY_JWT_SECRET || 'fallback-secret'
    );
    
    const token = await new SignJWT({
      sub: userId,
      email: primaryEmail,
      name: githubUser.name || githubUser.login,
      provider: 'github',
      meteorToken: stampedToken.token,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
    
    // Redirect to frontend with token
    const frontendUrl =
      process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3000';
    
    res.writeHead(302, {
      Location:
        `${frontendUrl}/app/dashboard` +
        `?meteor_token=${token}&` +
        `meteor_resume=${stampedToken.token}`,
    });
    res.end();
  } catch (err) {
    console.error('[github-oauth] error:', err);
    res.writeHead(500);
    res.end('OAuth error');
  }
});

// ============================================================================
// Google OAuth Endpoints
// ============================================================================

WebApp.connectHandlers.use('/auth/google', (req, res, next) => {
  // Only handle exact /auth/google route, not /auth/google/callback
  if (req.url !== '/' && req.url !== '') { next(); return; }
  const callbackUrl = 
    `${process.env.ROOT_URL}/auth/google/callback`
  
  console.log('[google-oauth] Initiating OAuth flow');
  console.log('[google-oauth] Client ID:', process.env.GOOGLE_CLIENT_ID);
  console.log('[google-oauth] Callback URL:', callbackUrl);
  
  const googleAuthUrl = 
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&scope=openid%20email%20profile` +
    `&state=${Random.secret()}`
  
  console.log('[google-oauth] Redirecting to:', googleAuthUrl);
  
  res.writeHead(302, { Location: googleAuthUrl })
  res.end()
})

WebApp.connectHandlers.use('/auth/google/callback',
  async (req, res) => {
    const { code } = Object.fromEntries(
      new URL(req.url, process.env.ROOT_URL).searchParams
    )
    
    if (!code) {
      res.writeHead(400)
      res.end('Missing code')
      return
    }
    
    try {
      const callbackUrl = 
        `${process.env.ROOT_URL}/auth/google/callback`
      
      // Exchange code for token
      const tokenRes = await fetch(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl
          })
        }
      )
      const tokenData = await tokenRes.json()
      const accessToken = tokenData.access_token
      
      // Get user info from Google
      const userRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { 
            Authorization: `Bearer ${accessToken}`
          }
        }
      )
      const googleUser = await userRes.json()
      
      const email = googleUser.email
      if (!email) {
        res.writeHead(400)
        res.end('No email found')
        return
      }
      
      const name = googleUser.name || email
      
      // Find or create user in Meteor
      const userId = await findOrCreateUser(email, name)
      
      // Create Meteor login token
      const stampedToken = 
        Accounts._generateStampedLoginToken()
      await Accounts._insertLoginToken(
        userId, stampedToken
      )
      
      // Sign a short-lived JWT for the frontend
      const { SignJWT } = await import('jose');
      
      // Use PROXY_JWT_SECRET for OAuth JWT signing
      const secret = new TextEncoder().encode(
        process.env.PROXY_JWT_SECRET || 'fallback-secret'
      );
      
      const token = await new SignJWT({
        sub: userId,
        email: email,
        name: name,
        provider: 'google',
        meteorToken: stampedToken.token,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret);
      
      // Redirect to frontend with token
      const frontendUrl =
        process.env.CORS_ORIGINS?.split(',')[0] || 
        'http://localhost:3000'
      
      res.writeHead(302, {
        Location:
          `${frontendUrl}/app/dashboard` +
          `?meteor_token=${token}&` +
          `meteor_resume=${stampedToken.token}`
      })
      res.end()
      
    } catch (err) {
      console.error('[google-oauth] error:', err)
      res.writeHead(500)
      res.end('OAuth error')
    }
  }
)

// ============================================================================
// Apple OAuth Endpoints
// ============================================================================

WebApp.connectHandlers.use('/auth/apple', (req, res, next) => {
  // Only handle exact /auth/apple route, not /auth/apple/callback
  if (req.url !== '/' && req.url !== '') { next(); return; }
  const callbackUrl = 
    `${process.env.ROOT_URL}/auth/apple/callback`
  
  const appleAuthUrl = 
    'https://appleid.apple.com/auth/authorize' +
    `?client_id=${process.env.APPLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code%20id_token` +
    `&scope=name%20email` +
    `&response_mode=form_post` +
    `&state=${Random.secret()}`
  
  res.writeHead(302, { Location: appleAuthUrl })
  res.end()
})

WebApp.connectHandlers.use('/auth/apple/callback',
  async (req, res) => {
    try {
      // Apple sends POST with form data
      let body = ''
      req.on('data', chunk => { body += chunk })
      await new Promise(resolve => req.on('end', resolve))
      
      const params = new URLSearchParams(body)
      const code = params.get('code')
      const idToken = params.get('id_token')
      const userParam = params.get('user')
      
      if (!code && !idToken) {
        res.writeHead(400)
        res.end('Missing code or id_token')
        return
      }
      
      // Parse user info from id_token (JWT)
      // Apple sends user name only on FIRST login
      let email = null
      let name = null
      
      if (idToken) {
        // Decode JWT payload (we trust Apple here,
        // full verification optional for now)
        const payload = JSON.parse(
          Buffer.from(
            idToken.split('.')[1], 'base64'
          ).toString()
        )
        email = payload.email
      }
      
      // First login: Apple sends user name
      if (userParam) {
        try {
          const userData = JSON.parse(userParam)
          const firstName = userData.name?.firstName || ''
          const lastName = userData.name?.lastName || ''
          name = `${firstName} ${lastName}`.trim() || email
        } catch {
          name = email
        }
      }
      
      if (!email) {
        res.writeHead(400)
        res.end('No email found from Apple')
        return
      }
      
      name = name || email
      
      // Find or create user in Meteor
      const userId = await findOrCreateUser(email, name)
      
      // Create Meteor login token
      const stampedToken = 
        Accounts._generateStampedLoginToken()
      await Accounts._insertLoginToken(
        userId, stampedToken
      )
      
      // Sign a short-lived JWT for the frontend
      const { SignJWT } = await import('jose');
      
      // Use PROXY_JWT_SECRET for OAuth JWT signing
      const secret = new TextEncoder().encode(
        process.env.PROXY_JWT_SECRET || 'fallback-secret'
      );
      
      const token = await new SignJWT({
        sub: userId,
        email: email,
        name: name,
        provider: 'apple',
        meteorToken: stampedToken.token,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret);
      
      // Apple sends POST so we need to redirect
      // using HTML meta refresh or JS redirect
      const frontendUrl =
        process.env.CORS_ORIGINS?.split(',')[0] || 
        'http://localhost:3000'
      
      const redirectUrl = 
        `${frontendUrl}/app/dashboard` +
        `?meteor_token=${token}&` +
        `meteor_resume=${stampedToken.token}`
      
      // Use HTML redirect since Apple uses POST
      res.writeHead(200, { 
        'Content-Type': 'text/html' 
      })
      res.end(`
        <html>
          <body>
            <script>
              window.location.href = '${redirectUrl}'
            </script>
            <noscript>
              <meta http-equiv="refresh" 
                content="0;url=${redirectUrl}">
            </noscript>
          </body>
        </html>
      `)
      
    } catch (err) {
      console.error('[apple-oauth] error:', err)
      res.writeHead(500)
      res.end('OAuth error')
    }
  }
)

// Build MAIL_URL from SMTP_* env vars so Meteor's `email` package (used by
// Accounts.sendResetPasswordEmail) can send. Runs at module load.
if (!process.env.MAIL_URL && process.env.SMTP_HOST) {
  process.env.MAIL_URL = buildMailUrl(process.env);
  console.log('[email] MAIL_URL configured: ' + process.env.MAIL_URL.replace(/\/\/[^@]+@/, '//***@'));
}
if (!process.env.ROOT_URL) {
  process.env.ROOT_URL = process.env.APP_URL || 'http://localhost:3000';
}

Meteor.startup(async() => {
  // Configure GitHub OAuth service
  await ServiceConfiguration.configurations.upsertAsync(
    { service: 'github' },
    {
      $set: {
        clientId: process.env.GITHUB_CLIENT_ID,
        secret: process.env.GITHUB_CLIENT_SECRET,
        loginStyle: 'redirect',
      },
    }
  );
  
  // Configure Google OAuth service
  await ServiceConfiguration.configurations.upsertAsync(
    { service: 'google' },
    {
      $set: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        secret: process.env.GOOGLE_CLIENT_SECRET,
        loginStyle: 'redirect'
      }
    }
  );
  
  // Configure Apple OAuth service
  await ServiceConfiguration.configurations.upsertAsync(
    { service: 'apple' },
    {
      $set: {
        clientId: process.env.APPLE_CLIENT_ID,
        loginStyle: 'redirect'
      }
    }
  );
  
  Wormhole.init({
    mode: 'opt-in',
    path: '/mcp',
    name: 'timehuddle',
    version: '0.1.0',
    apiKey: process.env.WORMHOLE_API_KEY || null,
    rest: { enabled: true, path: '/api', docs: true },
  });

  Wormhole.expose('tickets.list', {
    description: 'List non-deleted tickets for a team, newest first',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string', description: 'Team id (24-char hex)' },
      },
      required: ['teamId'],
    },
  });

  Wormhole.expose('tickets.get', {
    description: 'Get a single ticket by ID',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' } },
      required: ['ticketId'],
    },
  });

  Wormhole.expose('tickets.create', {
    description: 'Create a ticket in a team (creator is auto-assigned)',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        github: { type: 'string', description: 'GitHub issue/PR URL' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['teamId', 'title'],
    },
  });

  Wormhole.expose('tickets.updateStatus', {
    description: "Update a ticket's status and/or priority",
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['open', 'in-progress', 'blocked', 'reviewed', 'closed', 'deleted'],
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['ticketId'],
    },
  });

  Wormhole.expose('tickets.update', {
    description: "Edit a ticket's title, github link, and/or description",
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        title: { type: 'string' },
        github: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['ticketId'],
    },
  });

  Wormhole.expose('tickets.delete', {
    description: 'Soft-delete a ticket (sets status to deleted)',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' } },
      required: ['ticketId'],
    },
  });

  Wormhole.expose('tickets.assign', {
    description: 'Reassign a ticket to a set of team members (empty array unassigns)',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        assignedToUserIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['ticketId', 'assignedToUserIds'],
    },
  });

  Wormhole.expose('tickets.batchStatus', {
    description: 'Set the status of multiple tickets in one team',
    inputSchema: {
      type: 'object',
      properties: {
        ticketIds: { type: 'array', items: { type: 'string' } },
        teamId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['open', 'in-progress', 'blocked', 'reviewed', 'closed', 'deleted'],
        },
      },
      required: ['ticketIds', 'teamId', 'status'],
    },
  });

  Wormhole.expose('clock.active', {
    description: "The caller's active clock event in a team, or null",
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.start', {
    description: 'Clock in to a team (closes any dangling open events first)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.stop', {
    description: 'Clock out of a team (computes worked time minus meal breaks)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.pause', {
    description: 'Pause an active clock session (start a break)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.resume', {
    description: 'Resume a paused clock session (end a break)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.status', {
    description: 'Live clock status for a team: { event, workSeconds, isPaused } or null',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.activeForUser', {
    description: "The caller's active clock event across any team, or null",
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('clock.events', {
    description: 'All clock events for the caller (their own history)',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('clock.timesheet', {
    description: 'Timesheet sessions + summary for a user over an epoch-ms date range',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        startMs: { type: 'number' },
        endMs: { type: 'number' },
      },
      required: ['userId', 'startMs', 'endMs'],
    },
  });

  Wormhole.expose('clock.updateTimes', {
    description: "Update a clock event's timestamps and optional break intervals",
    inputSchema: {
      type: 'object',
      properties: {
        clockEventId: { type: 'string' },
        startTime: { type: 'number' },
        endTime: { type: ['number', 'null'] },
        breaks: { type: 'array', items: { type: 'object' } },
      },
      required: ['clockEventId'],
    },
  });

  Wormhole.expose('clock.deleteEvent', {
    description: 'Delete a clock event (owner or team admin)',
    inputSchema: {
      type: 'object',
      properties: { clockEventId: { type: 'string' } },
      required: ['clockEventId'],
    },
  });

  Wormhole.expose('clock.createManual', {
    description: 'Create a completed clock event for a past time range (manual backfill)',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        startTime: { type: 'number' },
        endTime: { type: 'number' },
      },
      required: ['teamId', 'startTime', 'endTime'],
    },
  });

  Wormhole.expose('clock.agreeAutoClockout', {
    description: "Mark the caller's active clock event as agreed to auto clock-out at 8h",
    inputSchema: {
      type: 'object',
      properties: { clockEventId: { type: 'string' } },
      required: ['clockEventId'],
    },
  });

  Wormhole.expose('clock.respondShiftReminder', {
    description: 'Agree or disagree to a shift-end reminder notification',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string' },
        action: { type: 'string', enum: ['agree', 'disagree'] },
      },
      required: ['notificationId', 'action'],
    },
  });

  // ── Activity (read-only) ────────────────────────────────────────────────────

  Wormhole.expose('clock.teamStatus', {
    description: 'Active clock status and today hours for all members of a team',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });


  Wormhole.expose('tickets.shareWithTimeharbor', {
    description: 'Flag or unflag a ticket for TimeHarbor import',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' }, shared: { type: 'boolean' } },
      required: ['ticketId', 'shared'],
    },
  });
  Wormhole.expose('tickets.bulkShareWithTimeharbor', {
    description: 'Flag or unflag multiple tickets for TimeHarbor import',
    inputSchema: {
      type: 'object',
      properties: {
        ticketIds: { type: 'array', items: { type: 'string' } },
        shared: { type: 'boolean' },
      },
      required: ['ticketIds', 'shared'],
    },
  });

  Wormhole.expose('huddle.getPostsByTicket', {
    description: 'Fetch all huddle posts for a specific ticket',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' } },
      required: ['ticketId'],
    },
  });

  // ─── Timers ────────────────────────────────────────────────────────────────
  Wormhole.expose('timers.getDay', {
    description: 'List WorkItems with timers for a local calendar day',
    inputSchema: { type: 'object', properties: { date: { type: 'string' }, tz: { type: 'string' } }, required: ['date'] },
  });
  Wormhole.expose('timers.getToday', {
    description: 'List WorkItems for today (local time). Admin can pass userId.',
    inputSchema: { type: 'object', properties: { tz: { type: 'string' }, userId: { type: 'string' } } },
  });
  Wormhole.expose('timers.getWeek', {
    description: 'Get per-day totals for a 7-day week',
    inputSchema: { type: 'object', properties: { date: { type: 'string' }, tz: { type: 'string' } }, required: ['date'] },
  });
  Wormhole.expose('timers.getRunning', {
    description: 'Get the current user running timer or null',
    inputSchema: { type: 'object', properties: {} },
  });
  Wormhole.expose('timers.getTeamRunning', {
    description: 'Get all running timers for members of a team',
    inputSchema: { type: 'object', properties: { teamId: { type: 'string' } }, required: ['teamId'] },
  });
  Wormhole.expose('timers.getTicketTotal', {
    description: 'Get total seconds for a ticket across all closed sessions',
    inputSchema: { type: 'object', properties: { ticketId: { type: 'string' } }, required: ['ticketId'] },
  });
  Wormhole.expose('timers.createEntry', {
    description: 'Create a WorkItem for a ticket on a given date',
    inputSchema: { type: 'object', properties: { ticketId: { type: 'string' }, date: { type: 'string' }, note: { type: 'string' }, startNow: { type: 'boolean' }, notifyAdmins: { type: 'boolean' } }, required: ['ticketId', 'date'] },
  });
  Wormhole.expose('timers.startSession', {
    description: 'Start a timer for a WorkItem',
    inputSchema: { type: 'object', properties: { entryId: { type: 'string' }, now: { type: 'number' }, tz: { type: 'string' } }, required: ['entryId'] },
  });
  Wormhole.expose('timers.stopSession', {
    description: 'Stop a running timer session',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, now: { type: 'number' } }, required: ['sessionId'] },
  });
  Wormhole.expose('timers.updateEntry', {
    description: 'Update a WorkItem note, duration, and/or ticket',
    inputSchema: { type: 'object', properties: { entryId: { type: 'string' }, note: { type: 'string' }, durationSeconds: { type: 'number' }, ticketId: { type: 'string' } }, required: ['entryId'] },
  });
  Wormhole.expose('timers.deleteEntry', {
    description: 'Delete a WorkItem and all its timers',
    inputSchema: { type: 'object', properties: { entryId: { type: 'string' }, notifyAdmins: { type: 'boolean' } }, required: ['entryId'] },
  });
  Wormhole.expose('timers.copyPrevious', {
    description: 'Copy entries from the most recent previous day into toDate',
    inputSchema: { type: 'object', properties: { toDate: { type: 'string' } }, required: ['toDate'] },
  });

  Wormhole.expose('timers.getUserWorkSummary', {
    description: 'Get tickets worked on by user in last 48 hours',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  });

  Wormhole.expose('activity.log', {
    description: 'Get the current user\'s activity log (cursor-paginated)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        before: { type: 'string', description: 'ISO 8601 cursor — events older than this' },
      },
    },
  });

  Wormhole.expose('activity.userLog', {
    description: 'Get activity log for a specific user (must share a non-personal team)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        before: { type: 'string', description: 'ISO 8601 cursor' },
      },
      required: ['userId'],
    },
  });

  Wormhole.expose('activity.ticketActivity', {
    description: 'Get activity events for a specific ticket (team members only)',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['ticketId'],
    },
  });

  // ── Notifications ────────────────────────────────────────────────────────────

  Wormhole.expose('notifications.getInbox', {
    description: 'Get the current user\'s notification inbox',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('notifications.markOneRead', {
    description: 'Mark a single notification as read',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string', description: 'Notification ID' },
      },
      required: ['notificationId'],
    },
  });

  Wormhole.expose('notifications.markAllRead', {
    description: 'Mark all notifications as read for the current user',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('notifications.deleteMany', {
    description: 'Delete multiple notifications',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Array of notification IDs' },
      },
      required: ['ids'],
    },
  });

  Wormhole.expose('notifications.getInvitePreview', {
    description: 'Get team invite preview from a notification',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string', description: 'Notification ID' },
      },
      required: ['notificationId'],
    },
  });

  Wormhole.expose('notifications.respondToInvite', {
    description: 'Respond to a team invite notification (join or ignore)',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string', description: 'Notification ID' },
        action: { type: 'string', enum: ['join', 'ignore'], description: 'Join the team or ignore the invite' },
      },
      required: ['notificationId', 'action'],
    },
  });

  Wormhole.expose('notifications.testPush', {
    description: 'Create a test push notification for the current user',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('notifications.pushSubscribe', {
    description: 'Register a push subscription (native device token or web push VAPID)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['native', 'webpush'] },
        token: { type: 'string' },
        platform: { type: 'string', enum: ['ios', 'android'] },
        endpoint: { type: 'string' },
        keys: { type: 'object' },
      },
      required: ['type'],
    },
  });

  Wormhole.expose('notifications.pushUnsubscribe', {
    description: 'Remove all push subscriptions for the current user',
    inputSchema: { type: 'object', properties: {} },
  });

  // ── Teams ───────────────────────────────────────────────────────────────────

  Wormhole.expose('teams.list', {
    description: 'List teams the caller belongs to',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('teams.ensurePersonal', {
    description: 'Create personal workspace if missing (idempotent)',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('teams.create', {
    description: 'Create a new team',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        orgId: { type: 'string' },
        parentTeamId: { type: 'string' },
      },
      required: ['name'],
    },
  });

  Wormhole.expose('teams.join', {
    description: 'Join a team by invite code',
    inputSchema: {
      type: 'object',
      properties: { teamCode: { type: 'string' } },
      required: ['teamCode'],
    },
  });

  Wormhole.expose('teams.subteams', {
    description: 'List sub-teams of a team',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('teams.rename', {
    description: 'Rename a team (admin only)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, newName: { type: 'string' } },
      required: ['teamId', 'newName'],
    },
  });

  Wormhole.expose('teams.delete', {
    description: 'Delete a team (admin only)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('teams.getMembers', {
    description: 'Get team members with resolved user details',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('teams.invite', {
    description: 'Invite a user to a team by email',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, email: { type: 'string' } },
      required: ['teamId', 'email'],
    },
  });

  Wormhole.expose('teams.getInvitation', {
    description: 'Get a team invitation preview',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
  });

  Wormhole.expose('teams.acceptInvite', {
    description: 'Accept a team invitation',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
  });

  Wormhole.expose('teams.revokeInvite', {
    description: 'Revoke a pending team invitation',
    inputSchema: {
      type: 'object',
      properties: { invitationId: { type: 'string' } },
      required: ['invitationId'],
    },
  });

  Wormhole.expose('teams.getPendingInvitations', {
    description: 'List email invitations sent for a team (team admin or org owner only)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('teams.removeMember', {
    description: 'Remove a member from a team (admin only)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, userId: { type: 'string' } },
      required: ['teamId', 'userId'],
    },
  });

  Wormhole.expose('teams.setRole', {
    description: 'Set a member\'s role to admin or member (admin only)',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        userId: { type: 'string' },
        role: { type: 'string', enum: ['admin', 'member'] },
      },
      required: ['teamId', 'userId', 'role'],
    },
  });

  Wormhole.expose('teams.setMemberPassword', {
    description: 'Admin-forced password reset for a team member',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        userId: { type: 'string' },
        newPassword: { type: 'string' },
      },
      required: ['teamId', 'userId', 'newPassword'],
    },
  });

  // ── Team Join Requests ────────────────────────────────────────────────────

  Wormhole.expose('teams.getPendingJoinRequests', {
    description: 'List pending join requests for a team (admin only)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('teams.approveJoinRequest', {
    description: 'Approve a team join request (admin only)',
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  });

  Wormhole.expose('teams.declineJoinRequest', {
    description: 'Decline a team join request (admin only)',
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  });

  Wormhole.expose('teams.getJoinRequestPreview', {
    description: 'Get join request preview from a notification (for notification action)',
    inputSchema: {
      type: 'object',
      properties: { notificationId: { type: 'string' } },
      required: ['notificationId'],
    },
  });

  Wormhole.expose('teams.respondToJoinRequest', {
    description: 'Approve or decline a join request from a notification',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string' },
        action: { type: 'string', enum: ['approve', 'decline'] },
      },
      required: ['notificationId', 'action'],
    },
  });

  // ── Channels ───────────────────────────────────────────────────────────────

  Wormhole.expose('channels.list', {
    description: 'List channels the caller can see in a team',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' } },
      required: ['teamId'],
    },
  });

  Wormhole.expose('channels.create', {
    description: 'Create a new channel in a team',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        members: { type: 'array', items: { type: 'string' } },
      },
      required: ['teamId', 'name'],
    },
  });

  Wormhole.expose('channels.getMessages', {
    description: 'Get paginated messages for a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        teamId: { type: 'string' },
        before: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['channelId', 'teamId'],
    },
  });

  Wormhole.expose('channels.sendMessage', {
    description: 'Send a message to a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        teamId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['channelId', 'teamId', 'text'],
    },
  });

  // ── Messages (DMs) ────────────────────────────────────────────────────────

  Wormhole.expose('messages.getThread', {
    description: 'Get paginated messages for a DM thread',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        adminId: { type: 'string' },
        memberId: { type: 'string' },
        before: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['teamId', 'adminId', 'memberId'],
    },
  });

  Wormhole.expose('messages.send', {
    description: 'Send a direct message',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string' },
        toUserId: { type: 'string' },
        text: { type: 'string' },
        adminId: { type: 'string' },
        ticketId: { type: 'string' },
      },
      required: ['teamId', 'toUserId', 'text', 'adminId'],
    },
  });

  // ── Users/Profiles ─────────────────────────────────────────────────────────

  Wormhole.expose('users.get', {
    description: 'Get public profile by user ID',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
  });

  Wormhole.expose('users.getByUsername', {
    description: 'Get public profile by username',
    inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
  });

  Wormhole.expose('users.batchGet', {
    description: 'Batch public profile lookup by ID array (cap 200)',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  });

  Wormhole.expose('users.updateProfile', {
    description: 'Update current user profile (name, bio, website, reportsToUserId)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        bio: { type: 'string' },
        website: { type: 'string' },
        reportsToUserId: { type: ['string', 'null'] },
      },
    },
  });

  Wormhole.expose('users.checkUsername', {
    description: 'Check username availability',
    inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
  });

  Wormhole.expose('users.claimUsername', {
    description: 'Claim a canonical username (one-time, immutable)',
    inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] },
  });

  // ── Organizations ─────────────────────────────────────────────────────────

  Wormhole.expose('orgs.list', { description: 'List organizations accessible to the caller', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.checkSlug', { description: 'Check org slug availability', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, excludeId: { type: 'string' } }, required: ['slug'] } });
  Wormhole.expose('orgs.create', { description: 'Create organization under enterprise', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, allowAutoJoin: { type: 'boolean' } }, required: ['enterpriseId', 'name'] } });
  Wormhole.expose('orgs.get', { description: 'Get organization details', inputSchema: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.update', { description: 'Update organization (name, slug, settings)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, allowAutoJoin: { type: 'boolean' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.updateSettings', { description: 'Update org auto-join setting', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, allowAutoJoin: { type: 'boolean' } }, required: ['orgId', 'allowAutoJoin'] } });
  Wormhole.expose('orgs.join', { description: 'Join organization (if auto-join enabled)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.listMembers', { description: 'List org members (manage permission)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.listUsers', { description: 'List org users (accessible)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.searchUsers', { description: 'Search users to add to org', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, q: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.setMemberRole', { description: 'Set org member role', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, userId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'member'] } }, required: ['orgId', 'userId', 'role'] } });
  Wormhole.expose('orgs.removeMember', { description: 'Remove org member', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, userId: { type: 'string' } }, required: ['orgId', 'userId'] } });
  Wormhole.expose('orgs.invite', { description: 'Invite a user to an organization by email', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, email: { type: 'string' } }, required: ['orgId', 'email'] } });
  Wormhole.expose('orgs.getInvitation', { description: 'Get an organization invitation preview', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } });
  Wormhole.expose('orgs.acceptInvite', { description: 'Accept an organization invitation', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } });
  Wormhole.expose('orgs.getPendingInvitations', { description: 'List email invitations sent for an organization (manage permission)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' } }, required: ['orgId'] } });
  Wormhole.expose('orgs.revokeInvite', { description: 'Revoke a pending organization invitation', inputSchema: { type: 'object', properties: { invitationId: { type: 'string' } }, required: ['invitationId'] } });
  Wormhole.expose('orgs.updateMemberReportsTo', { description: 'Update org member reports-to', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, userId: { type: 'string' }, reportsToUserId: { type: ['string', 'null'] } }, required: ['orgId', 'userId'] } });
  Wormhole.expose('orgs.updateReportsTo', { description: 'Update user reports-to (default org admin)', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, reportsToUserId: { type: ['string', 'null'] } }, required: ['userId'] } });
  Wormhole.expose('orgs.adminGet', { description: 'Get default org admin metadata', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.adminUpdate', { description: 'Update default org name (admin)', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } });
  Wormhole.expose('orgs.adminListUsers', { description: 'List users with default org roles (admin)', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.adminSetUserRole', { description: 'Set default org role for user (admin)', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'member'] } }, required: ['userId', 'role'] } });
  Wormhole.expose('orgs.publicGet', { description: 'Get default org metadata (all users)', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.publicListUsers', { description: 'List users with default org roles (all users)', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.blockMember', { description: 'Block org member (manage permission)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, targetUserId: { type: 'string' }, reason: { type: 'string' } }, required: ['orgId', 'targetUserId'] } });
  Wormhole.expose('orgs.unblockMember', { description: 'Unblock org member (manage permission)', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, targetUserId: { type: 'string' } }, required: ['orgId', 'targetUserId'] } });

  // ── Enterprises ───────────────────────────────────────────────────────────

  Wormhole.expose('enterprises.list', { description: 'List enterprises for the caller', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('enterprises.create', { description: 'Create enterprise', inputSchema: { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' } }, required: ['name'] } });
  Wormhole.expose('enterprises.get', { description: 'Get enterprise details', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' } }, required: ['enterpriseId'] } });
  Wormhole.expose('enterprises.updateName', { description: 'Update enterprise name', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, name: { type: 'string' } }, required: ['enterpriseId', 'name'] } });
  Wormhole.expose('enterprises.searchUsers', { description: 'Search users for enterprise', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, q: { type: 'string' } }, required: ['enterpriseId'] } });
  Wormhole.expose('enterprises.setMemberRole', { description: 'Set enterprise member role (owner only)', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, userId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin'] } }, required: ['enterpriseId', 'userId', 'role'] } });
  Wormhole.expose('enterprises.removeMember', { description: 'Remove enterprise member (owner only)', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, userId: { type: 'string' } }, required: ['enterpriseId', 'userId'] } });
  Wormhole.expose('enterprises.takeOwnership', {
    description: 'Complete initial installation and take ownership',
    inputSchema: { type: 'object', properties: {} },
  });

  Wormhole.expose('enterprise.installStatus', { description: 'Check enterprise installation status', inputSchema: { type: 'object', properties: {} } });

  // ── Personal Access Tokens ────────────────────────────────────────────────

  Wormhole.expose('tokens.list', { description: 'List personal access tokens', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('tokens.create', { description: 'Create a personal access token', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } });
  Wormhole.expose('tokens.revoke', { description: 'Revoke a personal access token', inputSchema: { type: 'object', properties: { tokenId: { type: 'string' } }, required: ['tokenId'] } });

  // ── Attachments ────────────────────────────────────────────────────────────

  Wormhole.expose('attachments.list', { description: 'List attachments for an entity', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['clock', 'ticket'] }, id: { type: 'string' } }, required: ['kind', 'id'] } });
  Wormhole.expose('attachments.add', { description: 'Add attachment to an entity', inputSchema: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', enum: ['video', 'image', 'link'] }, title: { type: 'string' }, thumbnail: { type: 'string' }, attachedTo: { type: 'object', properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind', 'id'] } }, required: ['url', 'type', 'attachedTo'] } });
  Wormhole.expose('attachments.remove', { description: 'Delete attachment (owner only)', inputSchema: { type: 'object', properties: { attachmentId: { type: 'string' } }, required: ['attachmentId'] } });

  // ── Media CRUD ────────────────────────────────────────────────────────────

  Wormhole.expose('media.list', { description: 'List media library items', inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } } });
  Wormhole.expose('media.listForUser', { description: 'List media for a user profile', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, limit: { type: 'integer' } }, required: ['userId'] } });
  Wormhole.expose('media.update', { description: 'Update media metadata (owner)', inputSchema: { type: 'object', properties: { mediaId: { type: 'string' }, title: { type: 'string' }, caption: { type: 'string' }, altText: { type: 'string' } }, required: ['mediaId'] } });
  Wormhole.expose('media.remove', { description: 'Delete media item + files (owner)', inputSchema: { type: 'object', properties: { mediaId: { type: 'string' } }, required: ['mediaId'] } });

  // ── PulseVault ────────────────────────────────────────────────────────────

  Wormhole.expose('pulsevault.reserve', {
    description: 'Reserve a videoid for TUS video upload',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        existingVideoid: { type: 'string' },
        target: { type: 'string', enum: ['ticket', 'library'] },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        videoid: { type: 'string' },
        uploadToken: { type: 'string' },
      },
    },
  });
  Wormhole.expose('pulsevault.reserveForLibrary', {
    description: 'Reserve a videoid for media library TUS upload',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        videoid: { type: 'string' },
        uploadToken: { type: 'string' },
      },
    },
  });

  Wormhole.expose('pulsevault.getVideo', {
    description: 'Get a single video from the media library by its artifactId',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'The artifact/video UUID' },
      },
      required: ['artifactId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
        mediaId: { type: 'string' },
        url: { type: 'string', description: 'Playback URL at /pulsevault/artifacts/:artifactId' },
        title: { type: 'string' },
        mimeType: { type: 'string' },
        size: { type: 'integer' },
        thumbnail: { type: 'string' },
        uploadedAt: { type: 'string', format: 'date-time' },
      },
    },
  });

  Wormhole.expose('pulsevault.listVideos', {
    description: 'List videos from the media library for the calling user',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 50)' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        videos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              artifactId: { type: 'string' },
              mediaId: { type: 'string' },
              url: { type: 'string' },
              title: { type: 'string' },
              mimeType: { type: 'string' },
              size: { type: 'integer' },
              thumbnail: { type: 'string' },
              uploadedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  });

  // Agenda foundation: defines clock jobs against the shared `agendajobs`
  // collection. Processor stays OFF unless METEOR_AGENDA_ENABLED=true, so it
  // won't compete with Fastify during coexistence (M1 flips it on).
  initAgenda().catch((err) => console.error('[agenda] init failed:', err));

  console.log('[timehuddle] meteor-backend up — REST /api, docs /api/docs, MCP /mcp');
});
