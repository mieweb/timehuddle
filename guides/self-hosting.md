---
title: Run it yourself
summary: Get a full copy of TimeHuddle running on your machine, then configure email, push, sign-in providers and Redmine.
section: Open source
order: 80
---

TimeHuddle is two programs and a database: a **React** frontend built with Vite, a **Meteor 3** backend, and **MongoDB** running as a replica set (Meteor follows its oplog for live updates).

| Service          | Port  |
| ---------------- | ----- |
| Frontend (Vite)  | 3000  |
| Backend (Meteor) | 3100  |
| MongoDB          | 27017 |
| Mailpit (email)  | 8025  |

## What you need

- **Node 24** — pinned in `.nvmrc`; run `nvm use`.
- **Docker**, for MongoDB and Mailpit — and, if you like, the backend.
- **Meteor 3**, only if you run the backend outside Docker ([install](https://www.meteor.com/install)).

## Get the code

The backend needs one git submodule, `meteor-wormhole`:

```bash
git clone https://github.com/mieweb/timehuddle.git
cd timehuddle
git submodule update --init vendor/meteor-wormhole
nvm use
npm install
```

## Start the backend

### With Docker

```bash
docker compose up -d meteor-backend
```

This starts MongoDB as a replica set, Mailpit to catch outgoing email at [localhost:8025](http://localhost:8025), and the Meteor backend on port 3100.

### Without Docker

Start MongoDB and Mailpit with Docker, then run Meteor yourself:

```bash
docker compose up -d mongodb mailpit
cd meteor-backend
npm install
export MONGO_URL="mongodb://localhost:27017/timehuddle?directConnection=true"
export MONGO_OPLOG_URL="mongodb://localhost:27017/local?directConnection=true"
npm start
```

`npm start` defaults email to Mailpit and the app URL to `http://localhost:3000`. Run outside Docker, the backend does not read an env file — export any other setting you need in the same shell.

## Start the frontend

In another terminal, from the repository root:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign up. The dev server forwards `/api`, `/uploads`, `/v1` and `/pulsevault` to the backend, so no other configuration is needed. Point it at a different backend with `API_TARGET`.

## Configuration

With Docker, put settings in `meteor-backend/.env.local` (it is git-ignored); without Docker, export them. The most common:

| Setting                                   | What it is for                                              |
| ----------------------------------------- | ----------------------------------------------------------- |
| `APP_URL`                                 | The address people open, used in emailed links              |
| `CORS_ORIGINS`                            | Origins allowed to call the API                             |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`    | Outgoing email                                              |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`   | Browser push notifications                                  |
| `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, … | Sign-in with GitHub, Google or Apple                        |
| `METEOR_AGENDA_ENABLED`                   | Reminders and auto clock-out (on by default in `npm start`) |

The frontend's sign-in buttons are chosen at build time with `VITE_SOCIAL_PROVIDERS` (default `github,apple`).

## Connect Redmine

To let people [work from Redmine](/docs/redmine), you need Redmine 5.0 or newer with its REST API enabled, and two settings:

```bash
REDMINE_BASE_URL=https://redmine.example.org
REDMINE_ENCRYPTION_KEY=   # generate with: openssl rand -base64 32
```

`REDMINE_ENCRYPTION_KEY` encrypts each person's API key at rest, so it must be random, not a passphrase. Without `REDMINE_BASE_URL`, Redmine is simply absent — not an error. Each person then connects their own account in **Settings → Redmine**.

## Production build

```bash
npm run build      # the frontend → dist/
npm run preview    # check the build locally
```

Serve `dist/` with any static server that falls back to `index.html` for unknown paths, since the app does its own routing.
