# TimeHuddle — Team Time Tracking & Collaboration

Real-time team time tracking and collaboration platform built with React 19, Vite, Tailwind CSS 4, and TypeScript — powered by a Meteor 3 + MongoDB backend.

Features **Clock In/Out**, **Ticket Tracking**, **Timesheets**, **Team Management**, and **Real-time Collaboration**.

| Stack        | Version | Notes                              |
| ------------ | ------- | ---------------------------------- |
| React        | 19.x    | Suspense / concurrent features     |
| Vite         | 8.x     | Fast dev server + production build |
| Tailwind CSS | 4.x     | Oxide (Lightning CSS) engine       |
| TypeScript   | 5.9.x   | Strict mode                        |
| Vitest       | 4.x     | Unit testing                       |

![Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-24.x-339933?logo=node.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Highlights

- **Email/password auth** — account creation, login, and password reset via the backend
- **Clock in/out** — real-time time tracking with per-ticket timers and media attachments
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

### Local Development Setup

#### 1. Prerequisites

- **Node.js 24.x** (run `nvm use` to activate the pinned version)
- **MongoDB** running locally or accessible via connection string

#### 2. Clone and install dependencies

```bash
git clone https://github.com/mieweb/timehuddle.git
cd timehuddle
nvm use
npm install
```

#### 3. Configure environment

Create a `.env` file in `meteor-backend/`:

```bash
# meteor-backend/.env
MONGO_URL=mongodb://localhost:27017/timehuddle
ROOT_URL=http://localhost:3100
PORT=3100
```

#### 4. Start MongoDB (if not running)

```bash
mongod --dbpath ~/data/db
```

Or use Docker:

```bash
docker run -d -p 27017:27017 --name mongodb mongo:8
```

#### 5. Start the Meteor backend

```bash
cd meteor-backend
npm install
npm run dev  # Starts on http://localhost:3100
```

#### 6. Seed the database (optional)

```bash
# From meteor-backend directory
npm run seed:dev
```

The frontend (Vite) runs on http://localhost:3000 and connects to the Meteor backend at http://localhost:3100.

### Environment

Copy `.env` and adjust if your backend URL differs:

```bash
# .env (already committed with defaults)
VITE_API_URL=http://localhost:4000
# VITE_VAPID_PUBLIC_KEY=your_vapid_public_key_here  # optional, for push notifications
```

## Development

### Seeds

After running `sh scripts/seed-docker.sh`, the following demo teams are created. Use their join codes to add users to teams via the UI.

| Team       | Join Code  |
| ---------- | ---------- |
| Developers | `ZDLYFY9T` |
| Accounting | `P2SRHYYK` |
| Product    | `FAKASXQ9` |
| Design     | `MHGT2L3Z` |
| Support    | `180YR2C3` |
| Operations | `R0VCXWDP` |

Demo user accounts all use the password `Password1!`. Emails follow the pattern `firstname@example.com` (e.g. `alice@example.com`).

### User Migration

If you need to migrate users from Better Auth to Meteor Accounts, run the automated migration script:

```bash
./run-migration.sh
```

This interactive script will guide you through:

1. Selecting your local Meteor database
2. Running a dry-run preview
3. Performing the actual migration
4. Verifying the results

See [meteor-backend/scripts/README.md](meteor-backend/scripts/README.md) for detailed documentation.

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

## License

MIT — see `LICENSE`.
