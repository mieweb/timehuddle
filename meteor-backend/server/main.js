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
// M0.e foundations — built/validated now, consumed by M1 clock + notifications.
import './email';
import './push';
import { initAgenda } from './agenda';

/**
 * CORS for the wormhole REST bridge (/api) — the Vite frontend on another
 * origin calls it directly. rawConnectHandlers runs before wormhole's
 * middleware, so preflights are answered here.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

WebApp.rawConnectHandlers.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
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

  // Agenda foundation: defines clock jobs against the shared `agendajobs`
  // collection. Processor stays OFF unless METEOR_AGENDA_ENABLED=true, so it
  // won't compete with Fastify during coexistence (M1 flips it on).
  initAgenda().catch((err) => console.error('[agenda] init failed:', err));

  console.log('[timehuddle] meteor-backend up — REST /api, docs /api/docs, MCP /mcp');
});
