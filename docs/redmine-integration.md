# TimeHuddle ↔ Redmine

## The goal

**You shouldn't have to open Redmine to do your day's work.** Connect your Redmine account once, and your Redmine issues appear in TimeHuddle alongside your Huddle tickets — to find, to work on, to time, to create and to update. The hours you track are sent to Redmine as "Spent time" when you say so.

This page is the overview: what the integration does and what it needs. The reasoning behind its rules is in [`redmine-design.md`](./redmine-design.md).

---

## What you can do

### 1. Connect your Redmine account

Settings → Redmine: paste your **personal Redmine API key**. TimeHuddle confirms who you are in Redmine and remembers the link. The key is encrypted and never sent back to the browser.

Everything below happens **as you**: TimeHuddle uses your own key, so Redmine applies your permissions and records you as the author of anything you change. There is no shared admin account.

### 2. See your Redmine issues beside Huddle tickets

`/app/tickets` shows one table of your team's Huddle tickets and **your** Redmine issues: the ones assigned to you, plus any other issue you have started a timer on. Source is a column and a filter, not a mode you switch into. Search, sorting, per-column filters and the Open/Closed switch all work across both.

### 3. Find any other issue from the search bar

Click into the Tickets search bar and suggestions open under it: your assigned issues plus the ones you logged time on, worked on recently or watch, each marked with why it is there. Typing filters the table as before and narrows the suggestions; after a pause, **More from Redmine** adds matching issues that are not in your table yet.

The search bar understands words from a title, **#1234**, a pasted Redmine link, and **@name** for what someone is working on.

From a suggestion you can open the issue, start a timer on it (**Shift+Enter**), or hide it. Hiding only removes the suggestion, for 15 days; **Settings → Redmine → Hidden suggestions** brings one back sooner.

### 4. Put work on My Board

Select the tickets and issues you plan to work on and move them to **My Board**, your personal shortlist. Anything on the board stays in your table, even after the issue is closed or reassigned.

### 5. Track time against a Redmine issue

Start a timer from a board row, a search suggestion, the Work page or the issue's own page. Starts, stops, breaks and multiple sittings are all recorded in TimeHuddle. Breaks are excluded automatically, because a break closes the running session and resuming opens a new one.

**A ticket timer needs an open shift.** If you are clocked out, TimeHuddle asks once, clocks you in (by way of the Clock page when your team requires a plan first) and then starts the timer you asked for. Clocking out, or the 8-hour auto clock-out, stops any running ticket timer, so nothing runs overnight by accident.

Your sessions show up on the Work page, nested under the right shift in the Dashboard timesheet, and in the Activity section of the issue's page.

### 6. Send your time to Redmine

**When a timer ends.** Stop a timer on a Redmine issue, or start another ticket, and TimeHuddle offers to send that issue's unsent time for the day straight away. You can add a sentence about the work, which becomes the entry's comment in Redmine, or send it without one. This works while you're still clocked in, and the next timer is already running while you answer. The activity is chosen for you from the ones the issue's project allows; you can pick another of them, and the list filters as you type. **Send** (or Cmd/Ctrl+Enter) sends it; **Later** (or Esc) sends nothing, and the time waits for the Clock page.

**From the Clock page.** Anything not sent that way (a prompt you closed, an entry Redmine refused, a timer that ended because you clocked out or took a break) is on the Clock page. Once you're clocked out with no timer running, press **Send work entries to Redmine**. You get a summary first: one card per issue per day, with the hours, which Redmine activity it will be logged under (changeable per entry), and room for a comment about the work. Press the hours to read them as Redmine stores them. Nothing is sent until you confirm.

After each entry is created, TimeHuddle reads it back from Redmine to confirm the hours were stored as sent.

- Entries are **created, never edited or deleted** — logged time is permanent, and correcting it is an administrative act in Redmine.
- **Unsent time from earlier days is included**, so forgetting to send on Monday doesn't lose Monday.
- Time you track on a day after sending it is offered again on its own, and goes to Redmine as a further entry.
- **Billable.** Where Redmine requires a Billable value on time entries, TimeHuddle copies it from the newest entry that has one: on the same issue, else in the same project, else your own. Each card shows the value it will be sent with. Where no entry has one (or Redmine has no such field) nothing extra is sent.
- If Redmine refuses an entry, you're told why in Redmine's own words, and the time stays unsent. **Never send** drops a row you don't want in Redmine; the time stays in TimeHuddle.
- Time logged in Redmine by hand is never changed or double-counted.

### 7. Create and update Redmine issues

- **New Ticket** asks whether you want a TimeHuddle ticket or a Redmine issue. The Redmine form covers project, tracker, subject, description, assignee (defaults to you) and priority.
- Each Redmine issue has its **own page inside TimeHuddle**, with a link to the issue in Redmine. From it you can change **status, priority, assignee and description**, and start or stop its timer.
- The status list only offers the changes your Redmine role and the project's workflow allow.
- If someone changed the issue in Redmine after you opened the page, your save is refused and you're offered a reload, so you can't quietly overwrite their edit. Only the fields you actually changed are sent.
- **Activity** shows the time people logged on the issue in Redmine, the issue's Redmine history, and your own TimeHuddle timers.
- **Attachments** (a link, or a video recorded with Pulse) are stored in TimeHuddle only. They are not added to the issue in Redmine.
- **Delete** removes a Redmine issue from your table and My Board. It never deletes anything in Redmine.

---

## How it flows

```mermaid
flowchart TD
    Settings["⚙️ Settings<br/>connect with a personal API key"]
    Tickets["📋 Tickets page<br/>Huddle tickets + your Redmine issues, one table"]
    Search["🔎 Search suggestions<br/>find and time any other issue"]
    Board["⭐ My Board<br/>your shortlist"]
    Clock["⏱️ Clock page<br/>clock in, break, clock out"]
    Sessions[("Sessions recorded in TimeHuddle<br/>starts, stops, breaks, several per day")]
    Detail["📄 Issue page in TimeHuddle<br/>status · priority · assignee · description"]
    Confirm["✅ Send work entries to Redmine<br/>review the summary, then confirm"]
    Redmine[("Redmine<br/>issues · Spent time")]

    Settings --> Tickets
    Redmine -->|"issues, read live"| Tickets
    Tickets --> Search
    Tickets --> Board
    Tickets --> Detail
    Clock -->|"a timer needs an open shift"| Sessions
    Board -->|"start / stop"| Sessions
    Search -->|"start"| Sessions
    Detail -->|"start / stop"| Sessions
    Sessions -->|"unsent time per issue per day"| Confirm
    Confirm -->|"creates time entries, then reads them back"| Redmine
    Detail -->|"creates and updates issues, as you"| Redmine

    classDef huddle fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
    classDef redmine fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
    classDef action fill:#dcfce7,stroke:#15803d,color:#14532d

    class Settings,Tickets,Search,Board,Clock,Sessions,Detail huddle
    class Redmine redmine
    class Confirm action
```

**The rule behind the picture:** TimeHuddle is the record of _how_ time was spent. Redmine's "Spent time" is a one-way summary of it, never an input. Detail — individual sessions, breaks, notes — stays in TimeHuddle; Redmine receives totals per issue per day.

---

## Two clocks, two numbers

TimeHuddle tracks time in two separate ways, and they are not meant to match:

|                   | What it measures                               | Where you see it                              | Sent to Redmine? |
| ----------------- | ---------------------------------------------- | --------------------------------------------- | ---------------- |
| **Shift clock**   | Your working day for a team, minus meal breaks | Clock page, Dashboard timesheet               | **No**           |
| **Ticket timers** | Time on one ticket or issue, per day           | Work page, ticket pages, Redmine's Spent time | **Yes**          |

You can be clocked in without any ticket timer running, so the shift total is usually larger. Only ticket timers reach Redmine.

---

## What you need

**As a user**

- A Redmine account with a **personal API key** (Redmine → My account → API access key).
- Permission to **log time** on the projects you track against. Without it, sending time fails with a clear message.
- To create or edit issues, the matching Redmine permissions (**Add issues** / **Edit issues**). Assigning an issue to someone else requires that their role can be assigned issues.

**As an administrator**

Redmine 5.0 or newer, with the REST API enabled, and these settings on the backend:

| Variable                      | Purpose                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `REDMINE_BASE_URL`            | The Redmine instance every user connects to. Left empty, Redmine is simply unavailable — not an error.          |
| `SOURCE_KEYS_SECRET`          | Secret used to encrypt each user's personal API keys at rest. See [Keeping keys safe](#keeping-keys-safe).      |
| `SOURCE_KEYS_SECRET_PREVIOUS` | Set only while rotating `SOURCE_KEYS_SECRET`, so existing keys can still be read and are re-encrypted.          |
| `REDMINE_ENCRYPTION_KEY`      | The older name for `SOURCE_KEYS_SECRET` (and `_PREVIOUS`). Still read when the new one isn't set.               |
| `REDMINE_ALLOWED_HOSTS`       | Extra hosts the server may send Redmine requests to in production. `REDMINE_BASE_URL`'s host is always allowed. |
| `REDMINE_ALLOW_CUSTOM_URL`    | Dev/test only: lets each user link a Redmine URL of their own. **Never enable in production.**                  |

## Keeping keys safe

Every key is encrypted with AES-256-GCM under `SOURCE_KEYS_SECRET`, sent only in a request header, left out of logs, and never returned to the browser.

**Check the secret.** It must be random: base64 or hex for at least 32 bytes. A passphrase isn't. A weak secret logs `[sources] SOURCE_KEYS_SECRET is weak` at boot; a later release will refuse to start with one, so fix it when you see the warning. To check one by hand (prints 32 or more for a good one):

```bash
printf %s "$SOURCE_KEYS_SECRET" | base64 -d | wc -c
```

**Make one:** `openssl rand -base64 32`.

**Rotate it** without anyone re-pasting their key: move the current value to `SOURCE_KEYS_SECRET_PREVIOUS`, put the new one in `SOURCE_KEYS_SECRET`, and restart. Each key is re-encrypted under the new secret the next time it's used. Remove `_PREVIOUS` after a while; anyone whose key wasn't used in between reconnects in Settings.

**Each key is locked to its owner.** A stored key decrypts only on its own member's row (and, for another server, that server's), so copying one onto another account in the database does nothing. Keys stored before this are locked the next time they're used; nobody reconnects.

**A key Redmine rejects stops being used.** When a key is reset or its account disabled in Redmine, TimeHuddle checks once with Redmine (`/users/current.json`) and, if that's refused too, stops sending the key. The member sees a "Couldn't reach Redmine" toast that takes them to Settings → Integrations to paste their current one. A `403` never stops a key: Redmine sends it for "not allowed" with a good key.

**Disconnecting doesn't reset the key in Redmine.** Redmine has no API for that. Someone worried their key leaked resets it on their Redmine account page (My account → API access key → Reset).

**Personal keys, not service accounts.** Each member connects with their own key, so Redmine's permissions apply and time is recorded as them. Dedicated low-privilege accounts per member would double every Redmine admin's account management for little gain: a key never leaves the server, it's encrypted and locked to its owner, the member can reset it, and the secret is strong.

**Which servers TimeHuddle calls.** In production only `REDMINE_BASE_URL` and the hosts in `REDMINE_ALLOWED_HOSTS`, over https, with no redirects followed, a time limit on every request, and answers capped at 20 MB. A member can't point it anywhere else. Servers aren't refused for resolving to a private address: the allowlist already decides where requests go, and a deployment's own Redmine may sit on an internal network on purpose.

---

## Not in this version

- **Tags and custom fields.** If a project requires a custom field, Redmine rejects the new issue and shows its own message.
- **Deleting issues in Redmine, or editing and deleting logged time** from TimeHuddle.
- **Anything flowing back from Redmine into TimeHuddle's own data.** Redmine issues are read live each time; their content is not stored in TimeHuddle's database, and there is no background sync.
- **Team-wide views of Redmine work.** A Redmine issue is only ever read through one person's key, so it stays out of team-level screens. An admin reading someone's timesheet sees an issue's title only if their own Redmine account can see it.
- **Personal-workspace users** logging Redmine time, since a ticket timer requires a team shift.
- Redmine comments, Redmine-side attachments and issue relations.
- **Connecting other Redmine servers from Settings.** Org owners can register more servers, and the backend keeps one account per member per server (`sources.connect`), but the Settings screen for it isn't built yet. Time is still sent to `REDMINE_BASE_URL` only.
