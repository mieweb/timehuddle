<div align="center">

# TimeHuddle — Team Time Tracking & Collaboration

Real-time team time tracking and collaboration platform built with React 19, Vite, Tailwind CSS 4, and TypeScript — powered by the [timecore](../timecore) Fastify + MongoDB backend.

Features **Clock In/Out**, **Ticket Tracking**, **Timesheets**, **Team Management**, and **Direct Messaging**.

| Stack        | Version | Notes                              |
| ------------ | ------- | ---------------------------------- |
| React        | 19.x    | Suspense / concurrent features     |
| Vite         | 8.x     | Fast dev server + production build |
| Tailwind CSS | 4.x     | Oxide (Lightning CSS) engine       |
| TypeScript   | 5.9.x   | Strict mode                        |
| Vitest       | 4.x     | Unit testing                       |

![Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-22.x-339933?logo=node.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## Highlights

- **Email/password auth** — account creation, login, and password reset via [timecore](../timecore)
- **Clock in/out** — real-time time tracking with per-ticket timers and YouTube link attachments
- **Ticket tracking** — create, assign, and track tickets with accumulated time
- **Timesheets** — view and manage time entries by date range
- **Team management** — create/join teams, invite members, role-based admin controls
- **Direct messaging** — send messages to team members with ticket context
- **Dashboard** — overview of today's time, weekly totals, active sessions, and team count
- **Shared validation** — [Zod](https://zod.dev) schemas shared across client forms and the API layer
- **Dark / light theme** — persisted via `localStorage`, flash-free on load
- **Strict tooling** — ESLint, Prettier, simple-import-sort, TypeScript strict mode

## Screenshots

<div align="center">

| Login (Light)                                                                                | Login (Dark)                                                                               | Dashboard (Light)                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| <img src="./public/screenshots/login-light.png" alt="Login page — light mode" width="300" /> | <img src="./public/screenshots/login-dark.png" alt="Login page — dark mode" width="300" /> | <img src="./public/screenshots/dashboard-light.png" alt="Dashboard — light mode" width="300" /> |

| Dashboard (Dark)                                                                              | Clock (Light)                                                                                  | Clock (Dark)                                                                                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| <img src="./public/screenshots/dashboard-dark.png" alt="Dashboard — dark mode" width="300" /> | <img src="./public/screenshots/clock-light.png" alt="Clock In/Out — light mode" width="300" /> | <img src="./public/screenshots/clock-dark.png" alt="Clock In/Out — dark mode" width="300" /> |

| Tickets (Light)                                                                             | Tickets (Dark)                                                                            | Teams (Light)                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| <img src="./public/screenshots/tickets-light.png" alt="Tickets — light mode" width="300" /> | <img src="./public/screenshots/tickets-dark.png" alt="Tickets — dark mode" width="300" /> | <img src="./public/screenshots/teams-light.png" alt="Teams — light mode" width="300" /> |

</div>

## Quick Start

You need both **timehuddle** (this repo, the frontend) and **timecore** (the backend API) running.

### 1. Start the backend (timecore)

```bash
cd ../timecore
npm install
npm run dev        # Fastify API on http://localhost:4000
```

### 2. Start the frontend (timehuddle)

```bash
git clone https://github.com/mieweb/timehuddle.git
cd timehuddle
npm install
npm run dev        # Vite dev server on http://localhost:3000
```

Open http://localhost:3000 — you'll see the login page. Create an account to get started.

### Environment

Copy `.env` and adjust if your timecore URL differs:

```bash
# .env (already committed with defaults)
VITE_TIMECORE_URL=http://localhost:4000
# VITE_VAPID_PUBLIC_KEY=your_vapid_public_key_here  # optional, for push notifications
```

## Project Structure

```
index.html                    # Vite entry point
client/
  main.tsx                    # React root — createRoot
  styles.css                  # Tailwind imports + minimal global styles
imports/
  features/                   # Feature modules — self-contained UI + types
    auth/
      schema.ts               # Zod schemas for auth validation
    clock/
      schema.ts               # Clock event schemas
      ClockPage.tsx           # Clock in/out UI
      TimesheetPage.tsx       # Timesheet view
    dashboard/
      DashboardPage.tsx       # Main dashboard with stats overview
    messages/
      schema.ts               # Message schemas
      MessagesPage.tsx        # Messaging UI
    notifications/
      NotificationsPage.tsx   # Notification inbox UI
    profile/
      schema.ts               # Profile schemas
      ProfilePage.tsx         # User profile page
    teams/
      schema.ts               # Team schemas
      TeamsPage.tsx           # Team management UI
    tickets/
      schema.ts               # Ticket schemas
      TicketsPage.tsx         # Ticket tracking UI
    inbox/
      InboxPage.tsx           # Dev email viewer (/inbox route, dev only)
  lib/
    api.ts                    # All timecore REST API wrappers
    constants.ts              # Shared validation limits, storage keys
    TeamContext.tsx           # React context for active team selection
    timeUtils.ts              # Time formatting utilities
    useBrand.ts               # Branding hook
    useSession.ts             # Auth session hook (reads timecore session)
    useTheme.ts               # Shared theme hook (read/apply/toggle)
    pushNotificationsClient.ts # Web Push subscription helpers
  ui/                         # Shared UI components
    AppLayout.tsx             # Root shell — routing, sidebar, header
    LoginForm.tsx             # Email/password auth form
    Sidebar.tsx               # Collapsible sidebar navigation
    AppHeader.tsx             # Top bar with title, theme toggle, user menu
    ThemeToggle.tsx           # Dark/light mode toggle
    UserDropdown.tsx          # User menu dropdown
    SettingsPage.tsx          # App settings
```

### How to Add a Feature

1. Create `imports/features/myfeature/`
2. Add `schema.ts` — Zod schemas + TypeScript types
3. Add `MyFeaturePage.tsx` — UI component (use `imports/lib/api.ts` for data)
4. Add route in `imports/ui/AppLayout.tsx` → `ROUTES` map
5. Add nav item in `imports/ui/Sidebar.tsx` → `NAV_SECTIONS`
6. Add backend endpoints in [timecore](../timecore)

### Conventions

- **API calls**: All data fetching goes through `imports/lib/api.ts` — typed wrappers around `fetch`
- **Validation**: Define Zod schemas in `schema.ts`, use them in client forms
- **Constants**: Shared limits/keys live in `imports/lib/constants.ts`
- **Auth**: Use `useSession()` from `imports/lib/useSession.ts` to get the current user
- **Theme**: Use `useTheme()` from `imports/lib/useTheme.ts` — never access `localStorage` directly
- **UI Components**: Use `@mieweb/ui` for all UI primitives (Button, Input, Modal, etc.)

## Auth Flow

1. User creates an account with email, password, and name (POST `/api/auth/sign-up/email`)
2. User signs in with email and password (POST `/api/auth/sign-in/email`)
3. Password reset available via email link
4. Authenticated users are redirected to `/app/dashboard`

## Commands

```bash
# Development
npm run dev           # Start Vite dev server on :3000
npm run lint          # Check code style
npm run typecheck     # Check TypeScript
npm run format        # Check Prettier formatting
npm test              # Run Vitest tests
npm run test:watch    # Run tests in watch mode

# Fixes
npm run lint:fix      # Auto-fix lint issues
npm run format:fix    # Auto-format code

# Production
npm run build         # Vite production build → dist/
npm run preview       # Preview the production build locally
```

## Styling & Theming

- **Tailwind CSS 4** with Oxide (Lightning CSS) engine
- Minimal custom CSS in `client/styles.css` (font smoothing + resets)
- Dark mode via `data-theme` attribute + `dark` class
- Theme persisted in `localStorage` using shared `THEME_KEY` constant

## Production

```bash
npm run build
# Serve the dist/ folder with any static host (Nginx, Caddy, Vercel, etc.)
# Set VITE_TIMECORE_URL to your production timecore URL at build time:
VITE_TIMECORE_URL=https://api.yourdomain.com npm run build
```

The backend (timecore) is a separate Fastify service — see [timecore README](../timecore/README.md) for deployment.

## License

MIT — see `LICENSE`.
