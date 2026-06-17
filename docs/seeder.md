# Seeder

Building a usable workspace by hand — users, org, team, tickets, roles — takes 10–20 minutes of clicking and leaves every dev with a different setup. The Seeder replaces that with a single YAML file and one click: reproducible, version-controlled, shareable.

- **Onboard a new dev** in under a minute.
- **Pin the exact data shape** that reproduces a bug and re-import it any time.
- **Reset to a clean demo state** before a walkthrough.

Available at `/app/seeder`, disabled in production. All seeded users get the default password **`Password1!`**.

## Usage

The Seeder page is split into two panels.

**Left panel — Presets**

Click a preset button to load its YAML into the editor. Three presets are available:

- **Team** — 5 users and 1 team. Requires an org to be selected in the sidebar (see below).
- **Org + Team** — 3 users, 1 org, 1 team, and 1 ticket. Self-contained; no org selection needed.
- **Single User** — 2 standalone users. Useful for quick auth and role testing.

**Right panel — YAML editor**

Edit the YAML directly or paste your own. Syntax is validated on every keystroke; the **Import** button stays disabled until the YAML is valid.

**Selecting an org for top-level teams**

When the YAML contains a `teams:` key at the root level (without a wrapping `organizations:`), the page shows a banner indicating which org the teams will be attached to. Select an org from the sidebar dropdown before importing. If no org is selected the **Import** button is disabled and the banner shows an amber warning.

**Running an import**

Click **Import**. On success a green summary appears (e.g. `Created: 5 users, 0 orgs, 1 teams, 2 tickets`) and the page reloads after two seconds so the new data is visible everywhere. On failure a red error message is shown instead.

Imports are idempotent — running the same YAML twice will not duplicate data.

---

## Document structure

A seed import document is a YAML file with up to four top-level keys. All are optional, but at least one entity must be present to do anything useful.

```yaml
users: [] # standalone user definitions
teams: [] # top-level teams (requires org selected in the UI)
organizations: [] # orgs, each may contain teams
```

These keys can be combined freely. For example, `users:` + `teams:` creates accounts and a team; `organizations:` alone (with nested teams) creates a full hierarchy.

---

## Schema reference

### User

Defined under `users:`. Standalone user entries let you set a name, username, and reporting structure. You do **not** need to list every user here — any email referenced anywhere in the document is automatically created if it doesn't already exist.

| Field       | Type     | Required | Notes                                                                                           |
| ----------- | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `email`     | string   | **yes**  | Login address. Used as the unique key.                                                          |
| `name`      | string   | no       | Display name. Defaults to the email local-part, title-cased (e.g. `sarah-lead` → `Sarah Lead`). |
| `username`  | string   | no       | Unique handle. Stays `null` (unclaimed) if omitted.                                             |
| `reportsTo` | ObjectId | no       | 24-char hex `_id` of an existing user in the database.                                          |
| `id`        | ObjectId | no       | Pin a specific `_id`. Auto-generated if omitted.                                                |

```yaml
users:
  - email: alice@example.com
    name: Alice Admin
    username: alice
  - email: bob@example.com
    name: Bob Builder
```

---

### Team

Defined under `teams:` (top-level) or `organization.teams:` (nested under an org).

At least one `members` or `admins` entry is required. Admins are automatically included
in `members` — a team is only visible to its members, so an admin who is not also a
member would be invisible.

| Field         | Type     | Required | Notes                                                                     |
| ------------- | -------- | -------- | ------------------------------------------------------------------------- |
| `name`        | string   | **yes**  | Unique within the org.                                                    |
| `members`     | string[] | no\*     | Emails or ObjectIds. \*At least one member **or** admin is required.      |
| `admins`      | string[] | no       | Must be a subset of members. Admins are auto-added to members if missing. |
| `code`        | string   | no       | Short team code (e.g. `ACME1`). Auto-generated from the name if omitted.  |
| `description` | string   | no       |                                                                           |
| `tickets`     | Ticket[] | no       | Tickets to create under this team. See [Ticket](#ticket).                 |
| `id`          | ObjectId | no       | Pin a specific `_id`.                                                     |

```yaml
teams:
  - name: Platform Team
    code: PLAT01
    members:
      - alice@example.com
      - bob@example.com
    admins:
      - alice@example.com
    tickets:
      - title: Set up CI pipeline
        priority: high
        createdBy: alice@example.com
```

---

### Organization

Defined under `organizations:`.

| Field           | Type     | Required | Notes                                                          |
| --------------- | -------- | -------- | -------------------------------------------------------------- |
| `name`          | string   | **yes**  |                                                                |
| `slug`          | string   | no       | URL-safe identifier. Auto-generated from name if omitted.      |
| `owners`        | string[] | no       | Emails or ObjectIds. Added to `org_members` with role `owner`. |
| `admins`        | string[] | no       | Emails or ObjectIds. Added to `org_members` with role `admin`. |
| `allowAutoJoin` | boolean  | no       | Whether users can auto-join. Defaults to `true`.               |
| `teams`         | Team[]   | no       | Teams nested under this org.                                   |
| `id`            | ObjectId | no       | Pin a specific `_id`.                                          |

```yaml
organizations:
  - name: Acme Corp
    slug: acme-corp
    allowAutoJoin: false
    owners:
      - alice@example.com
    teams:
      - name: Platform Team
        members:
          - bob@example.com
```

---

### Ticket

Defined inside a `tickets:` list.

| Field         | Type     | Required | Notes                                                                            |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `title`       | string   | **yes**  | Unique within the team.                                                          |
| `status`      | string   | no       | `open` \| `in-progress` \| `blocked` \| `reviewed` \| `closed`. Default: `open`. |
| `priority`    | string   | no       | `low` \| `medium` \| `high` \| `critical`. Default: `medium`.                    |
| `description` | string   | no       |                                                                                  |
| `createdBy`   | string   | no       | Email or ObjectId. Defaults to the first user resolved in the import.            |
| `assignedTo`  | string[] | no       | Emails or ObjectIds.                                                             |

```yaml
tickets:
  - title: Fix login redirect
    status: in-progress
    priority: high
    createdBy: alice@example.com
    assignedTo:
      - bob@example.com
```

---

## User references

Anywhere a user reference appears (`members`, `admins`, `owners`, `createdBy`,
`assignedTo`) you can use:

- **An email address** — If the account doesn't exist yet, it is created automatically with the default password `Password1!`. You don't need to list it under `users:` first.
- **A 24-char hex ObjectId** — Must reference a user already in the database. Useful for pinning to a specific existing account.

---

## Import behavior

| Behavior                | Detail                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Additive updates**    | Re-importing merges into existing data. Orgs and teams are matched by natural key (slug / name+orgId); new members and admins are added to existing teams, never removed. Tickets are skipped if they already exist (matched by title+teamId). |
| **Admins are members**  | Admins are automatically added to `members`. A team is only visible to its members.                                                                         |
| **Org membership**      | All team members are automatically added to the parent org's `org_members` collection.                                                                      |
| **Top-level teams**     | `teams:` at the root level requires an org to be selected in the Seeder UI sidebar. The team is attached to that org.                                       |
| **User creation order** | All user accounts are created before any org/team/ticket references are resolved. No ordering dependency in the YAML.                                       |

---

## Presets

Three built-in presets are available in the Seeder UI:

| Preset          | What it creates                  | When to use                                             |
| --------------- | -------------------------------- | ------------------------------------------------------- |
| **Team**        | 5 users, 1 team, 2 tickets       | Quick team setup attached to the currently selected org |
| **Org + Team**  | 3 users, 1 org, 1 team, 1 ticket | Full self-contained hierarchy including an org          |
| **Single User** | 2 users only                     | Minimal accounts for auth and role testing              |
