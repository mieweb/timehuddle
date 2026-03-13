<div align="center">

# TimeHuddle — Team Time Tracking & Collaboration

Real-time team time tracking and collaboration platform built with Meteor 3.5, React 19, Tailwind CSS 4, and TypeScript.

Features **Clock In/Out**, **Ticket Tracking**, **Timesheets**, **Team Management**, and **Direct Messaging** — all powered by Meteor's real-time DDP protocol.

| Stack       | Version               | Notes                                |
| ----------- | --------------------- | ------------------------------------ |
| Meteor      | 3.5-beta.4 (Node 22)  | ESM, modern rspack build toolchain   |
| React       | 19                    | Suspense / concurrent features ready |
| TailwindCSS | 4.x                   | Oxide (Lightning CSS) engine         |
| TypeScript  | 5.x                   | Strict mode                          |

![Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-22.x-339933?logo=node.js&logoColor=white)
![Meteor](https://img.shields.io/badge/Meteor-3.5--beta.4-DE4F4F?logo=meteor&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## Highlights

- **Email/password auth** — account creation, login, and password reset with team code verification
- **Clock in/out** — real-time time tracking with per-ticket timers and YouTube link attachments
- **Ticket tracking** — create, assign, and track tickets with accumulated time
- **Timesheets** — view and manage time entries by date range
- **Team management** — create/join teams, invite members, role-based admin controls
- **Direct messaging** — send messages to team members with ticket context
- **Dashboard** — overview of today's time, weekly totals, active sessions, and team count
- **Shared validation** — [Zod](https://zod.dev) schemas shared between server methods and client forms
- **Typed data hooks** — `useMethod` wrapper eliminates raw `Meteor.call` from components
- **Dark / light theme** — persisted via `localStorage`, flash-free with SSR inline script
- **SSR + hydration** — login page rendered server-side, hydrated on client
- **Security defaults** — rate limiting, Mongo indexes, scoped publications, input validation
- **Strict tooling** — ESLint, Prettier, simple-import-sort, TypeScript strict mode

## Quick Start

```bash
# Install Meteor (if not already installed)
curl https://install.meteor.com/ | sh

# Clone and run
git clone https://github.com/mieweb/timehuddle.git
cd timehuddle
npm ci --no-audit --no-fund
meteor run
```

Open http://localhost:3000 — you'll see the login page. Create an account to get started.

## Project Structure

```
client/
  main.tsx                  # React root — createRoot / hydrateRoot
  main.html                 # HTML shell with <div id="root">
  styles.css                # Tailwind imports + minimal global styles
imports/
  features/                 # Feature modules — self-contained API + UI
    auth/
      api.ts                # Account creation, profile update, password reset
      schema.ts             # Zod schemas for auth validation
    clock/
      api.ts                # Clock events collection, start/stop, ticket timers
      schema.ts             # Clock event schemas
      ClockPage.tsx          # Clock in/out UI
      TimesheetPage.tsx      # Timesheet view
    dashboard/
      DashboardPage.tsx      # Main dashboard with stats overview
    messages/
      api.ts                # Direct messages collection and methods
      schema.ts             # Message schemas
      MessagesPage.tsx       # Messaging UI
    profile/
      api.ts                # User profile methods and publication
      schema.ts             # Profile schemas
      ProfilePage.tsx        # User profile page
      UsernameBadge.tsx      # Display name component
    teams/
      api.ts                # Teams collection, CRUD, invites, roles
      schema.ts             # Team schemas
      TeamsPage.tsx          # Team management UI
    tickets/
      api.ts                # Tickets collection, CRUD, time tracking
      schema.ts             # Ticket schemas
      TicketsPage.tsx        # Ticket tracking UI
    inbox/                   # Dev email viewer (auto-disabled in production)
  lib/
    constants.ts             # Shared validation limits, storage keys
    TeamContext.tsx           # React context for active team selection
    timeUtils.ts             # Time formatting utilities
    useBrand.ts              # Branding hook
    useMethod.ts             # Typed Meteor.call wrapper hook
    useTheme.ts              # Shared theme hook (read/apply/toggle)
  startup/
    client.ts                # Client startup (feature API imports)
    server.ts                # Accounts config, dev email capture, user pub
    seed.ts                  # E2E seed data (dev only)
    ssr.tsx                  # SSR for login page + SEO meta tags
  ui/                        # Shared UI components
    AppLayout.tsx            # Root shell — routing, sidebar, header
    LoginForm.tsx            # Email/password auth form
    Sidebar.tsx              # Collapsible sidebar navigation
    AppHeader.tsx            # Top bar with title, theme toggle, user menu
    ThemeToggle.tsx           # Dark/light mode toggle
    UserDropdown.tsx          # User menu dropdown
    SettingsPage.tsx          # App settings
    LandingPage.tsx           # Marketing page (not used as default route)
server/
  main.ts                    # Server entry — imports features + startup
```

### How to Add a Feature

1. Create `imports/features/myfeature/`
2. Add `schema.ts` — Zod schemas + TypeScript types
3. Add `api.ts` — collection, methods, publication (import schemas)
4. Add `MyFeaturePage.tsx` — UI component (import `useMethod` + constants)
5. Add route in `imports/ui/AppLayout.tsx` → `ROUTES` map
6. Add nav item in `imports/ui/Sidebar.tsx` → `NAV_SECTIONS`
7. Import `api.ts` in `server/main.ts` and `imports/startup/client.ts`

### Conventions

- **Validation**: Define Zod schemas in `schema.ts`, use them in both server methods and client forms
- **Constants**: Shared limits/keys live in `imports/lib/constants.ts`
- **Methods**: Components use `useMethod('method.name')` — never call `Meteor.call` directly
- **Theme**: Use `useTheme()` from `imports/lib/useTheme.ts` — never access `localStorage` directly for theme
- **Types**: Export TypeScript interfaces from `schema.ts`, re-export from `api.ts`
- **UI Components**: Use `@mieweb/ui` for all UI primitives (Button, Input, Modal, etc.)

## Auth Flow

1. User creates an account with email, password, first name, and last name
2. User signs in with email and password
3. Password reset is available via team code verification
4. Authenticated users are redirected to `/app/dashboard`

## Commands

```bash
# Development
meteor run                    # Start dev server (2-5 min first startup)
npm run lint                  # Check code style
npm run typecheck             # Check TypeScript
npm run format                # Check Prettier formatting
npm test                      # Run Vitest tests
npm run test:watch            # Run tests in watch mode

# Fixes
npm run lint:fix              # Auto-fix lint issues
npm run format:fix            # Auto-format code

# Production
meteor build ../build --directory   # Build (5-15 min)
```

## Feature API Reference

### Auth

| Method                    | Args                                                    | Description                        |
| ------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `createUserAccount`       | `{ email, password, firstName, lastName }`              | Create a new user account          |
| `updateUserProfile`       | `{ firstName, lastName }`                               | Update user profile name           |
| `resetPasswordWithTeamCode` | `{ email, teamCode, newPassword }`                    | Reset password with team code      |

### Clock

| Method                | Args                                              | Description                      |
| --------------------- | ------------------------------------------------- | -------------------------------- |
| `clock.start`         | `{ teamId }`                                      | Clock in for a team              |
| `clock.stop`          | `{ teamId, youtubeShortLink? }`                   | Clock out with optional link     |
| `clock.addTicket`     | `{ clockEventId, ticketId, now }`                 | Start tracking a ticket          |
| `clock.stopTicket`    | `{ clockEventId, ticketId, now }`                 | Stop tracking a ticket           |
| `clock.updateYoutubeLink` | `{ clockEventId, youtubeShortLink }`          | Update YouTube link on entry     |
| `clock.updateTimes`   | `{ clockEventId, startTimestamp?, endTimestamp? }` | Edit clock event times           |
| `clock.getTimesheetData` | `{ userId, startDate, endDate }`               | Fetch timesheet data             |

### Teams

| Method                | Args                              | Description                  |
| --------------------- | --------------------------------- | ---------------------------- |
| `teams.ensurePersonalWorkspace` | —                       | Create personal workspace    |
| `teams.create`        | `{ name }`                        | Create a new team            |
| `teams.join`          | `{ teamCode }`                    | Join a team via invite code  |
| `teams.updateName`    | `{ teamId, newName }`             | Rename a team                |
| `teams.delete`        | `teamId`                          | Delete a team                |
| `teams.addAdmin`      | `{ teamId, userId }`              | Promote member to admin      |
| `teams.removeAdmin`   | `{ teamId, userId }`              | Demote admin to member       |
| `teams.removeMember`  | `{ teamId, userId }`              | Remove a team member         |
| `teams.invite`        | `{ teamId, email }`               | Invite user by email         |
| `teams.setMemberPassword` | `{ teamId, userId, newPassword }` | Set member password      |

### Tickets

| Method                  | Args                                                 | Description                  |
| ----------------------- | ---------------------------------------------------- | ---------------------------- |
| `tickets.create`        | `{ teamId, title, github?, accumulatedTime? }`       | Create a ticket              |
| `tickets.update`        | `{ ticketId, updates }`                              | Update ticket fields         |
| `tickets.delete`        | `ticketId`                                           | Delete a ticket              |
| `tickets.start`         | `{ ticketId, now }`                                  | Start ticket timer           |
| `tickets.stop`          | `{ ticketId, now }`                                  | Stop ticket timer            |
| `tickets.batchUpdateStatus` | `{ ticketIds, status, teamId }`                  | Batch update ticket status   |
| `tickets.assign`        | `{ ticketId, assignedToUserId }`                     | Assign ticket to user        |

### Messages

| Method          | Args                                           | Description          |
| --------------- | ---------------------------------------------- | -------------------- |
| `messages.send` | `{ teamId, toUserId, text, adminId, ticketId? }` | Send a direct message |

### Profile

| Method           | Args                                    | Description         |
| ---------------- | --------------------------------------- | ------------------- |
| `profile.update` | `{ displayName?, bio?, website? }`      | Update user profile |

## Styling & Theming

- **Tailwind CSS 4** with Oxide (Lightning CSS) engine
- Minimal custom CSS in `client/styles.css` (font smoothing + resets)
- Dark mode via `data-theme` attribute + `dark` class
- Theme persisted in `localStorage` using shared `THEME_KEY` constant
- SSR inline script prevents flash of wrong theme

## Production

```bash
meteor build ../build --directory
cd ../build/bundle
npm install --production
PORT=3000 MONGO_URL="mongodb://..." ROOT_URL="https://..." MAIL_URL="smtp://..." node main.js
```

Add a reverse proxy (Nginx / Caddy) for TLS and compression.

## License

MIT — see `LICENSE`.
