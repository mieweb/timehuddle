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

const sessionTokenProp = {
  sessionToken: {
    type: 'string',
    description: 'better-auth session token (REST callers); omit over DDP after auth.bridge',
  },
};

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
        ...sessionTokenProp,
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
        ...sessionTokenProp,
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
        ...sessionTokenProp,
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
        ...sessionTokenProp,
      },
      required: ['ticketId'],
    },
  });

  Wormhole.expose('tickets.delete', {
    description: 'Soft-delete a ticket (sets status to deleted)',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' }, ...sessionTokenProp },
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
        ...sessionTokenProp,
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
        ...sessionTokenProp,
      },
      required: ['ticketIds', 'teamId', 'status'],
    },
  });

  Wormhole.expose('clock.active', {
    description: "The caller's active clock event in a team, or null",
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, ...sessionTokenProp },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.start', {
    description: 'Clock in to a team (closes any dangling open events first)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, ...sessionTokenProp },
      required: ['teamId'],
    },
  });

  Wormhole.expose('clock.stop', {
    description: 'Clock out of a team (computes worked time minus meal breaks)',
    inputSchema: {
      type: 'object',
      properties: { teamId: { type: 'string' }, ...sessionTokenProp },
      required: ['teamId'],
    },
  });

  console.log('[timehuddle] meteor-backend up — REST /api, docs /api/docs, MCP /mcp');
});
