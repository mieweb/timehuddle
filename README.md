# TimeHuddle — Team Time Tracking & Collaboration

Real-time team time tracking and collaboration platform built with React 19, Vite, Tailwind CSS 4, and TypeScript — powered by a Fastify + MongoDB backend.

Features **Clock In/Out**, **Ticket Tracking**, **Timesheets**, **Team Management**, **Direct Messaging**, **Push Notifications**, and **Media Library**.

## Tech Stack

### Frontend
| Technology   | Version | Purpose                            |
| ------------ | ------- | ---------------------------------- |
| React        | 19.x    | UI library with concurrent features |
| Vite         | 8.x     | Fast dev server + build tooling    |
| Tailwind CSS | 4.x     | Oxide (Lightning CSS) styling      |
| TypeScript   | 5.9.x   | Type-safe development              |
| @mieweb/ui   | 0.2.4   | Component library                  |
| Motion       | 12.x    | Framer Motion animations           |
| Vitest       | 4.x     | Unit testing                       |
| Playwright   | 1.58.x  | E2E testing                        |

### Backend
| Technology    | Version | Purpose                          |
| ------------- | ------- | -------------------------------- |
| Fastify       | 5.x     | High-performance web framework   |
| MongoDB       | 6.x     | Document database (native driver)|
| Mongoose      | 9.x     | ODM (pilot phase)                |
| Better Auth   | 1.6.x   | Authentication with OAuth        |
| Agenda        | 6.x     | Job scheduling                   |
| Web Push      | 3.6.x   | Push notifications               |
| Firebase Admin| 13.x    | Mobile push (FCM)                |
| Nodemailer    | 8.x     | Email delivery                   |

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

Choose one of three methods to run TimeHuddle locally:

### Method 1: PM2 (Recommended for Network Testing)

Perfect for testing on mobile devices or accessing from other machines on your network.

```bash
# First time setup
nvm use
npm install

# Update ecosystem.config.cjs with your IP address
# Then start both frontend and backend with PM2
pm2 start ecosystem.config.cjs

# View logs
pm2 logs

# Stop services
pm2 stop all
```

Access the app from any device on your network:
- **Frontend**: `http://YOUR_IP:3000` (e.g., http://10.20.69.11:3000)
- **Backend API**: `http://YOUR_IP:4000`

The `ecosystem.config.cjs` file configures both processes with proper environment variables and auto-restart on crashes.

### Method 2: Docker (Easiest All-in-One)

The fastest way to get everything running locally is Docker Compose — MongoDB, the backend, and the frontend all start together with live reload.

```bash
docker compose up
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **MongoDB**: `mongodb://localhost:27017/timehuddle`

`node_modules` are installed automatically inside the containers on first start. Subsequent starts skip the install and boot quickly.

**Seed the database** with demo data after the containers are up:

```bash
sh scripts/seed-docker.sh
```

**Environment**: create `backend/.env.local` to override any backend env vars (it's optional and gitignored). At minimum the backend needs:

```bash
# backend/.env.local
MONGODB_URI=mongodb://mongodb:27017/timehuddle
TRUSTED_ORIGINS=http://localhost:3000
```

> These are already set in `docker-compose.yml` — only needed if you override them.

---

### Method 3: Manual Setup

Run frontend and backend in separate terminal sessions.

#### 1. Clone and install

```bash
git clone https://github.com/mieweb/timehuddle.git
cd timehuddle
nvm use
npm install
```

#### 2. Start MongoDB

```bash
# Using Docker
docker run -d -p 27017:27017 --name timehuddle-mongo mongo:latest

# OR using Homebrew
brew services start mongodb-community
```

#### 3. Start the backend (Terminal 1)

```bash
cd backend
npm run dev        # Fastify API on http://localhost:4000
```

#### 4. Start the frontend (Terminal 2)

```bash
npm run dev        # Vite dev server on http://localhost:3000
```

Open http://localhost:3000 — you'll see the login page. Create an account to get started.

### Environment Configuration

#### Frontend (.env.local)

```bash
# Backend API URL (for Capacitor/native builds or network testing)
VITE_TIMECORE_URL=http://localhost:4000

# Web Push Notifications (optional)
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key_here

# Pollenate Feedback Integration (optional)
VITE_POLLENATE_API_KEY=your_api_key
VITE_POLLENATE_BUGS_INBOX_KEY=bug-reports
VITE_POLLENATE_FEATURE_INBOX_KEY=feature-request
VITE_POLLENATE_FEEDBACK_URL=https://pollenate.dev/f/your-feedback-url
```

#### Backend (backend/.env.local)

```bash
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/timeharbor
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:4000
TRUSTED_ORIGINS=http://localhost:3000,capacitor://localhost
APP_URL=http://localhost:3000
DEFAULT_ORG_KEY=default
DEFAULT_ORG_NAME=Default Organization

# GitHub OAuth (optional)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Email (optional, for password reset)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password

# Push Notifications (optional)
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
FIREBASE_SERVICE_ACCOUNT=path/to/firebase-service-account.json
```

---

## Project Structure

```
timehuddle/
├── backend/                    # Fastify API server
│   ├── src/
│   │   ├── server.ts          # Entry point, bootstrap
│   │   ├── routes/            # Route definitions (schema + handler)
│   │   ├── controllers/       # Request/response handling
│   │   ├── services/          # Business logic
│   │   ├── models/            # MongoDB/Mongoose models
│   │   ├── middleware/        # Auth, CORS, error handling
│   │   ├── lib/               # Shared utilities
│   │   └── types/             # TypeScript type definitions
│   ├── migrations/            # Database migrations (migrate-mongo)
│   ├── scripts/               # Seed scripts, utilities
│   └── tests/                 # Backend unit tests
│
├── src/                        # Frontend React application
│   ├── main.tsx               # React entry point
│   ├── styles.css             # Tailwind + theme tokens
│   ├── features/              # Feature-sliced modules
│   │   ├── clock/             # Clock in/out
│   │   ├── teams/             # Team management
│   │   ├── tickets/           # Ticket tracking
│   │   ├── timesheet/         # Timesheet views
│   │   ├── dashboard/         # Dashboard widgets
│   │   └── messages/          # Direct messaging
│   ├── lib/                   # Shared utilities
│   │   ├── api.ts             # API client
│   │   ├── useSession.ts      # Auth context
│   │   └── TeamContext.tsx    # Team state
│   └── ui/                    # Shell components
│       ├── AppLayout.tsx      # Main layout + routing
│       ├── Sidebar.tsx        # Navigation
│       └── AppHeader.tsx      # Top bar
│
├── packages/                   # Shared packages
│   └── youtube/               # YouTube metadata extraction
│
├── e2e/                        # Playwright E2E tests
├── public/                     # Static assets
├── android/                    # Capacitor Android project
├── ios/                        # Capacitor iOS project
└── scripts/                    # Build and dev scripts
```

---

## Core Features

### Authentication & Authorization
- Email/password registration and login
- GitHub OAuth integration
- Password reset via email
- Role-based access control (Admin, Member)
- Organization and team permissions

### Time Tracking
- Clock in/out with real-time timer
- Per-ticket time tracking
- Break tracking (manual and automatic)
- Media attachments (screenshots, videos)
- Work summary and daily totals
- Weekly timesheet view

### Ticket Management
- Create, assign, and track tickets
- Accumulated time per ticket
- Status management (Open, In Progress, Closed)
- Ticket descriptions and metadata
- YouTube URL metadata extraction

### Team Collaboration
- Create and join teams with join codes
- Team member management
- Role assignment (Admin/Member)
- Direct messaging between team members
- Team activity feed

### Notifications
- Web push notifications
- Mobile push (FCM for Android/iOS)
- Email notifications
- In-app notification center
- Real-time SSE streams

### Dashboard & Reports
- Today's time summary
- Weekly totals
- Active sessions
- Team member count
- Work entry history

### Mobile Support
- Capacitor-powered native apps
- TestFlight distribution (iOS)
- Android APK builds
- Deep linking support
- Native push notifications

---

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

## Commands

### Frontend (Root Directory)

```bash
# Development
npm run dev              # Start Vite dev server on :3000
npm run dev:mobile       # Start Vite with network access
npm run lint             # Check code style
npm run typecheck        # Check TypeScript
npm run format           # Check Prettier formatting
npm test                 # Run Vitest tests
npm run test:watch       # Run tests in watch mode
npm run test:all         # Run all tests (frontend + backend + packages)

# Fixes
npm run lint:fix         # Auto-fix lint issues
npm run format:fix       # Auto-format code

# Production
npm run build            # Vite production build → dist/
npm run preview          # Preview the production build locally

# Mobile (Capacitor)
npm run dev:ios          # Build + sync + open in Xcode
npm run dev:android      # Build + sync + open in Android Studio
npm run testflight:ios   # TestFlight build for iOS
npm run testflight:android # TestFlight build for Android

# E2E Testing
npm run screenshots      # Run Playwright screenshot tests
npx playwright test      # Run all E2E tests
```

### Backend (backend/)

```bash
# Development
npm run dev              # Start Fastify with tsx watch
npm run typecheck        # Check TypeScript
npm run lint             # Check Prettier formatting
npm run format:fix       # Auto-format code
npm test                 # Run Vitest tests
npm run test:watch       # Run tests in watch mode

# Database
npm run migrate          # Run pending migrations
npm run migrate:status   # Check migration status
npm run migrate:down     # Rollback last migration
npm run seed             # Seed database with demo data
npm run seed:hierarchy   # Seed organization hierarchy

# Production
npm run build            # Compile to dist/
npm start                # Run compiled server
```

### PM2 Process Manager

```bash
# Start/Stop
pm2 start ecosystem.config.cjs    # Start both services
pm2 restart all                   # Restart both services
pm2 stop all                      # Stop both services
pm2 delete all                    # Remove from PM2 list

# Monitoring
pm2 status                        # Show process status
pm2 logs                          # Tail all logs
pm2 logs timehuddle-backend       # Backend logs only
pm2 logs timehuddle-frontend      # Frontend logs only
pm2 logs --lines 50               # Show last 50 lines
pm2 monit                         # Real-time monitoring dashboard

# Advanced
pm2 save                          # Save current process list
pm2 startup                       # Enable PM2 on system boot
pm2 flush                         # Clear all logs
```

---

## Architecture

### Backend: Route → Controller → Service Pattern

Every backend feature follows a strict three-layer separation:

| Layer          | Location                   | Responsibility                                              |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| **Route**      | `backend/src/routes/`      | Schema declaration, auth hooks, wires request to controller |
| **Controller** | `backend/src/controllers/` | Extracts params, calls service(s), formats reply            |
| **Service**    | `backend/src/services/`    | Business logic and database access — no Fastify types       |

**Example flow:**
```
GET /v1/teams/:teamId/members
  → routes/teams.ts (schema + auth)
  → controllers/team.controller.ts (param extraction + reply formatting)
  → services/team.service.ts (MongoDB query)
```

### Frontend: Feature-Sliced Design

The frontend is organized by feature modules, each containing:
- Components (UI elements)
- Hooks (custom React hooks)
- Types (TypeScript interfaces)
- Utilities (feature-specific helpers)

**Path aliases:**
- `@ui/*` → `src/ui/*` (shell components)
- `@lib/*` → `src/lib/*` (shared utilities)

### Real-Time Communication

- **Server-Sent Events (SSE)** for live updates (clock status, notifications, team changes)
- **WebSocket** support for future features
- **Push Notifications** via Web Push API and Firebase Cloud Messaging

### Database Schema

MongoDB collections:
- `users` — User accounts and profiles
- `teams` — Team definitions and settings
- `team_members` — Team membership and roles
- `tickets` — Ticket definitions and metadata
- `clockevents` — Clock in/out events
- `breaks` — Break tracking
- `workentries` — Aggregated time entries
- `messages` — Direct messages
- `notifications` — In-app notifications
- `media` — Media library (videos, screenshots)

### Authentication Flow

1. User registers or logs in via email/password or GitHub OAuth
2. Better Auth issues session tokens (stored in httpOnly cookies)
3. Frontend sends requests with cookies automatically
4. Backend middleware validates session and attaches `req.user`
5. Routes check permissions via CASL ability checks

---

## API Documentation

When the backend is running, visit:
- **Swagger UI**: http://localhost:4000/docs
- **OpenAPI JSON**: http://localhost:4000/docs/json

All routes are auto-documented via Fastify schema definitions.

---

## Testing

### Unit Tests
- **Frontend**: Vitest + React Testing Library
- **Backend**: Vitest with MongoDB Memory Server

### E2E Tests
- **Playwright** for full browser automation
- Tests cover: login, clock, tickets, timesheet, notifications, and more
- Run with: `npx playwright test`

### Test Coverage
```bash
npm run test:all    # Run all unit tests
npm test            # Frontend tests only
npm run test:backend # Backend tests only
```

---

## Deployment

### Production Build

```bash
# Frontend
npm run build        # Output: dist/

# Backend
cd backend
npm run build        # Output: backend/dist/
npm start            # Run compiled server
```

### Environment Variables

Ensure all required environment variables are set in production:
- `MONGODB_URI` — MongoDB connection string
- `BETTER_AUTH_SECRET` — Auth secret key (generate with `openssl rand -base64 32`)
- `BETTER_AUTH_URL` — Backend URL (e.g., https://api.timehuddle.com)
- `TRUSTED_ORIGINS` — Allowed origins for CORS
- `APP_URL` — Frontend URL (e.g., https://timehuddle.com)

### Docker Production

```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following the coding standards
4. Run tests: `npm run test:all`
5. Commit with conventional commits (`feat:`, `fix:`, `chore:`, etc.)
6. Push to your branch
7. Open a Pull Request

### Code Quality

- **ESLint** — enforces code style
- **Prettier** — auto-formatting
- **TypeScript strict mode** — full type safety
- **Husky pre-commit hooks** — runs lint and format on staged files

---

## License

MIT — see `LICENSE`.
