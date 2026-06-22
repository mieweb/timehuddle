/**
 * TimeHuddle Meteor backend (Phase 1 PoC).
 *
 * - DDP publications give reactive Tickets + Clock data (oplog-backed, shared
 *   Mongo with the Fastify backend).
 * - meteor-wormhole exposes the methods below as REST (/api, Swagger at
 *   /api/docs) and MCP tools (/mcp) for AI agents.
 */
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { Wormhole } from 'meteor/wreiske:meteor-wormhole';

import './collections';
import './auth-bridge';
import { signProxyJwt } from './auth-bridge';
import './tickets';
import './clock';
import './timers';
import './notifications';
import './presence';
import './activity';
// M2 — Collaboration
import './channels'; // must precede teams (teams.create calls ensureDefaultChannel)
import './teams';
import './messages';
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

/**
 * CORS for ALL routes — the Vite frontend on another origin calls both DDP and
 * HTTP endpoints. Global middleware catches everything before any other handlers.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

// Global CORS — catches ALL routes (DDP, /api, /uploads, etc.)
WebApp.rawConnectHandlers.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

// /api/whoami — no extra CORS needed (global middleware handles it)
WebApp.connectHandlers.use('/api/whoami', async (req, res) => {

  // Only works when proxy headers are trusted
  if (process.env.TRUST_PROXY_HEADERS !== 'true') {
    res.writeHead(404);
    res.end();
    return;
  }

  if (!process.env.PROXY_JWT_SECRET) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'PROXY_JWT_SECRET not configured' }));
    return;
  }

  const email = req.headers['x-email'];
  if (!email) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'No proxy identity headers' }));
    return;
  }

  const firstName = req.headers['x-user-first-name'] || '';
  const lastName = req.headers['x-user-last-name'] || '';
  const name = `${firstName} ${lastName}`.trim() || email;

  try {
    const token = await signProxyJwt(email, name);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ token }));
  } catch (err) {
    console.error('[auth/whoami] failed:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Failed to sign token' }));
  }
});

Meteor.startup(() => {
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
  Wormhole.expose('orgs.updateMemberReportsTo', { description: 'Update org member reports-to', inputSchema: { type: 'object', properties: { orgId: { type: 'string' }, userId: { type: 'string' }, reportsToUserId: { type: ['string', 'null'] } }, required: ['orgId', 'userId'] } });
  Wormhole.expose('orgs.updateReportsTo', { description: 'Update user reports-to (default org admin)', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, reportsToUserId: { type: ['string', 'null'] } }, required: ['userId'] } });
  Wormhole.expose('orgs.adminGet', { description: 'Get default org admin metadata', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.adminUpdate', { description: 'Update default org name (admin)', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } });
  Wormhole.expose('orgs.adminListUsers', { description: 'List users with default org roles (admin)', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.adminSetUserRole', { description: 'Set default org role for user (admin)', inputSchema: { type: 'object', properties: { userId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin', 'member'] } }, required: ['userId', 'role'] } });
  Wormhole.expose('orgs.publicGet', { description: 'Get default org metadata (all users)', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('orgs.publicListUsers', { description: 'List users with default org roles (all users)', inputSchema: { type: 'object', properties: {} } });

  // ── Enterprises ───────────────────────────────────────────────────────────

  Wormhole.expose('enterprises.list', { description: 'List enterprises for the caller', inputSchema: { type: 'object', properties: {} } });
  Wormhole.expose('enterprises.create', { description: 'Create enterprise', inputSchema: { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' } }, required: ['name'] } });
  Wormhole.expose('enterprises.get', { description: 'Get enterprise details', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' } }, required: ['enterpriseId'] } });
  Wormhole.expose('enterprises.updateName', { description: 'Update enterprise name', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, name: { type: 'string' } }, required: ['enterpriseId', 'name'] } });
  Wormhole.expose('enterprises.searchUsers', { description: 'Search users for enterprise', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, q: { type: 'string' } }, required: ['enterpriseId'] } });
  Wormhole.expose('enterprises.setMemberRole', { description: 'Set enterprise member role (owner only)', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, userId: { type: 'string' }, role: { type: 'string', enum: ['owner', 'admin'] } }, required: ['enterpriseId', 'userId', 'role'] } });
  Wormhole.expose('enterprises.removeMember', { description: 'Remove enterprise member (owner only)', inputSchema: { type: 'object', properties: { enterpriseId: { type: 'string' }, userId: { type: 'string' } }, required: ['enterpriseId', 'userId'] } });

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

  // Agenda foundation: defines clock jobs against the shared `agendajobs`
  // collection. Processor stays OFF unless METEOR_AGENDA_ENABLED=true, so it
  // won't compete with Fastify during coexistence (M1 flips it on).
  initAgenda().catch((err) => console.error('[agenda] init failed:', err));

  console.log('[timehuddle] meteor-backend up — REST /api, docs /api/docs, MCP /mcp');
});
