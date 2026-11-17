# Connect GitHub

Each member connects their own GitHub account in **Settings → Sources**, in one click. TimeHuddle then shows the GitHub issues and pull requests they can already access, in the Tickets search bar and on the ticket page. Nothing is registered per org. See [#873](https://github.com/mieweb/timehuddle/issues/873).

## Setting Up a Deployment

Connect GitHub uses the OAuth app GitHub sign-in uses, and stores tokens encrypted with `REDMINE_ENCRYPTION_KEY`. A deployment with sign-in working and that key set needs nothing more. Otherwise, once per deployment:

1. Register an OAuth app under the org that runs the deployment: **Settings → Developer settings → OAuth Apps**. Members see this app's name and owner on GitHub's approval page.
2. Set its redirect URI to `<ROOT_URL>/auth/github/callback`.
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the backend's environment, and `REDMINE_ENCRYPTION_KEY` if Redmine hasn't already set it, then restart it. Without the key, Connect fails when GitHub sends the member back.

Until both are set, the GitHub card in Settings says GitHub isn't set up, and everything else works.

## What Members Grant

GitHub's `repo` scope, its only one that covers private repos. It also covers code, which the GitHub card says up front. TimeHuddle calls only GitHub's issue, pull request, search, repo list and user APIs.

The token is encrypted with `REDMINE_ENCRYPTION_KEY`, the same as a Redmine key (see [redmine-integration.md](redmine-integration.md)), never reaches the browser, and is refreshed if GitHub gave it an expiry. Disconnecting revokes it at GitHub. A token GitHub stops accepting is marked rejected, stops being sent, and the card asks the member to connect again.

## Org Approval

GitHub restricts OAuth apps by default for an org, so its private repos appear once its owner approves the app, under the org's **Third-party access** settings. A member can request that from GitHub.

## Which Issues Show

A member picks the accounts and organizations to bring issues from (none picked means all of them). Before they type, the search bar lists open issues and pull requests assigned to them and updated in the last 8 days. Typing searches those accounts' repos by words in the title, by `repo-123`, or by a pasted address.

## How It's Stored

Nothing is converted. A ticket that shows a GitHub issue is a TimeHuddle ticket carrying the issue's address (`github`, `linkIsIssue`); `timehuddle-223` is read from that address and shown beside the ticket's own ID. Starting a timer or adding a search result to My Board creates the ticket carrying that address in the selected team, or opens the one that already does. No existing ticket is rewritten and nothing is migrated.

A member who can't read that address, or hasn't connected, sees the ticket as a plain link. Time on it stays in TimeHuddle: Redmine is the only source time is sent to.

The connection lives in `github_links`, one row per member, separate from sign-in's `services.github`, which keeps no token.
