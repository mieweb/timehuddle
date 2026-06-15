# Redmine Integration

> **STATUS: IDEA** — This is a rough idea, not a plan. Nothing here is approved or committed.

## The Idea

Allow Huddle to connect with a Redmine instance so that teams using Redmine for issue tracking can see their work in Huddle without duplicating data entry.

## What Redmine Is

[Redmine](https://www.redmine.org/) is an open-source project management and issue tracking tool. Many teams, particularly in engineering and government, run self-hosted Redmine instances as their primary tracker.

---

## Goals

- Surface Redmine issues in Huddle without replacing Redmine
- Allow time logged in Huddle to sync back to Redmine time entries
- Keep Redmine as the source of truth for issue data

---

## Open Questions

- **Read-only or bidirectional?** Should Huddle only read from Redmine, or also write back (time entries, status updates)?
- **Authentication**: Redmine supports API keys — is that sufficient, or do we need OAuth?
- **Self-hosted only or Redmine Cloud?** Most Redmine installs are self-hosted; network access may require a connector or webhook approach.
- **Field mapping**: How do Redmine issue fields map to Huddle ticket fields?
- **Project ↔ Team mapping**: How does a Redmine project map to a Huddle team?
- **Sync frequency**: Polling vs. webhooks?

---

## Possible Scope for a First Version

- Connect a Redmine instance via API key
- Import Redmine projects as read-only ticket lists in Huddle
- Allow timers in Huddle to be associated with a Redmine issue
- Optionally post time entries back to Redmine on timer stop

---

## Relationship to Other Plans

- **Tickets** — Redmine issues would surface as a read-only ticket source alongside native Huddle tickets
- **Timers** — Time logged against Redmine issues could sync back via the Redmine time entries API
- **Exporters** — Redmine time data could participate in payroll/reporting exports

---

## Out of Scope (for Now)

- Full two-way issue sync
- Creating or editing Redmine issues from Huddle
- Redmine wiki or document integration
- Multi-instance Redmine support per team
