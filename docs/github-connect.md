# Connect GitHub

Each member connects their own GitHub account in **Settings → Sources**, in one click. TimeHuddle then reads and updates the issues and pull requests they can already access. Nothing is registered per org. See [#734](https://github.com/mieweb/timehuddle/issues/734).

## Setting Up a Deployment

Connect GitHub uses the OAuth app GitHub sign-in uses, so a deployment with sign-in working needs nothing more. Otherwise, once per deployment:

1. Register an OAuth app under the org that runs the deployment: **Settings → Developer settings → OAuth Apps**. Members see this app's name and owner on GitHub's approval page.
2. Set its redirect URI to `<ROOT_URL>/auth/github/callback`, and leave **Expire user access tokens** on.
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the backend's environment, then restart it.

Until both are set, the Sources page says GitHub isn't set up, and everything else works.

## What Members Grant

GitHub's `repo` scope, its only one that covers private repos. It also covers code, which the Sources row says up front. TimeHuddle calls only GitHub's issue, pull request, search and user APIs.

Tokens are encrypted like every other source key (see [redmine-integration.md](redmine-integration.md)), never reach the browser, and refresh when they expire. Disconnecting revokes the token at GitHub.

## Org Approval

GitHub restricts OAuth apps by default for an org, so its private repos appear once its owner approves the app, under the org's **Third-party access** settings. A member can request that from GitHub.

## How It's Stored

A ticket displayed as a GitHub issue keeps only its address (`github`, `linkIsIssue`), so nothing is migrated. A member who can't read that address, or hasn't connected, sees the ticket as a plain link. Time on it stays in TimeHuddle: Redmine is the only source time is sent to.
