/**
 * Tool schemas for the Ozwell AI agent.
 *
 * These definitions are used when registering tools with the Ozwell Agent
 * Registration API (server-side) and optionally inline via OzwellChatConfig
 * when using a parent key. The tool handlers themselves live in OzwellWidget.tsx.
 *
 * https://mieweb.github.io/ozwellai-api/backend/agents
 */

export interface OzwellToolParam {
  type: string;
  description: string;
  enum?: string[];
}

export interface OzwellTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, OzwellToolParam>;
      required: string[];
    };
  };
}

export const OZWELL_TOOLS: OzwellTool[] = [
  // ── Navigation ─────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'navigate',
      description:
        'Navigate the user to a different page in the TimeHuddle app. Use this when the user asks to go somewhere or open a section.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'App route path, e.g. /app/dashboard, /app/clock, /app/tickets, /app/work, /app/timesheet, /app/teams, /app/messages, /app/notifications, /app/activity, /app/settings',
          },
        },
        required: ['path'],
      },
    },
  },

  // ── Read context ────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_current_user',
      description: "Get the currently logged-in user's name, email, and ID.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_page',
      description: 'Get the current page/route the user is viewing.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_team',
      description: "Get the currently selected team's name, ID, and member count.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_teams',
      description: 'List all teams the user belongs to.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Clock ───────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_clock_status',
      description: 'Check whether the user is currently clocked in or out and when they started.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clock_in',
      description: 'Clock the user in for the currently selected team.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clock_out',
      description: 'Clock the user out for the currently selected team.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_timesheet_entry',
      description: 'Update the start or end time of a timesheet (clock) entry by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Clock event ID to update' },
          startTime: { type: 'string', description: 'New start time as ISO 8601 string (optional)' },
          endTime: { type: 'string', description: 'New end time as ISO 8601 string (optional)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_timesheet_entry',
      description: 'Delete a timesheet (clock) entry by its ID. This cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Clock event ID to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ── Tickets ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_tickets',
      description: 'Get all tickets for the currently selected team.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ticket',
      description: 'Create a new ticket in the currently selected team.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Ticket title' },
          description: { type: 'string', description: 'Optional ticket description' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_ticket',
      description:
        "Update a ticket's title, description, status, or priority. Only provide the fields you want to change.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ticket ID to update' },
          title: { type: 'string', description: 'New title (optional)' },
          description: { type: 'string', description: 'New description (optional)' },
          status: {
            type: 'string',
            description: 'New status (optional)',
            enum: ['open', 'in-progress', 'done', 'blocked'],
          },
          priority: {
            type: 'string',
            description: 'New priority (optional)',
            enum: ['low', 'medium', 'high', 'critical'],
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_ticket',
      description: 'Delete a ticket by its ID. This cannot be undone — confirm with the user first.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ticket ID to delete' },
        },
        required: ['id'],
      },
    },
  },

  // ── Teams ───────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_team',
      description: 'Create a new team.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Team name' },
          description: { type: 'string', description: 'Optional team description' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_team',
      description: 'Rename a team by its ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Team ID to rename' },
          name: { type: 'string', description: 'New team name' },
        },
        required: ['id', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_team',
      description:
        'Delete a team by its ID. This is destructive and cannot be undone — always confirm with the user first.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Team ID to delete' },
        },
        required: ['id'],
      },
    },
  },
];
