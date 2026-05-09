# GitHub Integration

> **STATUS: IDEA** — This is a rough idea, not a plan. Nothing here is approved or committed.

## The Idea

Connect TimeHuddle to GitHub so that teams can see their issues, pull requests, and commits alongside their time and work context — without leaving TimeHuddle.

---

## Rough Ideas

- Advanced Linkage of a GitHub repo to a TimeHuddle team
- Surface GitHub issues as a read-only ticket source
- Associate timers with GitHub issues or PRs
- Show recent commits or PR activity on a user's profile or activity feed
- Optionally post time entries back as PR comments or issue notes
- Trigger standup context from recent GitHub activity (commits, PRs merged, reviews)

---

## Open Questions

- **Scope**: issues only, or also PRs, commits, and actions?
- **Auth**: GitHub OAuth app or personal access token?
- **Org vs repo**: connect at the org level or per-repo?
- **Sync direction**: read-only from GitHub, or write back (comments, labels)?
- **Repo ↔ Team mapping**: one repo per team, or many repos per team?
- **Sync frequency**: polling, webhooks, or on-demand?
- **Public vs private repos**: any access restrictions to handle?

---

## Relationship to Other Plans

- **Tickets** — GitHub issues could appear as a read-only ticket source
- **Timers** — Time logged could be associated with a GitHub issue or PR
- **Profiles** — Recent GitHub activity could feed the team visibility layer
- **Standups** — Recent commits and PR merges could pre-populate standup context

---

## Out of Scope (for Now)

- Creating or editing GitHub issues from TimeHuddle
- CI/CD or GitHub Actions integration
- Code review workflows inside TimeHuddle
- GitLab, Bitbucket, or other Git hosts (separate ideas)
