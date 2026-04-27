# Custom Fields / Free-Form Data Model

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

As TimeHuddle grows beyond basic time tracking, features like **Daily Standups**,
**Sprint Reviews**, and **Team Dashboards** will need structured-but-flexible data.
A scrum master running standups doesn't want the same rigid form as every other team.
A team tracking bugs needs different fields than a team tracking client deliverables.

Hardcoding schemas for every feature will create a maintenance mess. We need a
generalized layer — similar to how Asana custom fields or GitHub Projects board
columns work — that lets team admins define the shape of their data without
requiring a code change.

---

## The Idea

Allow teams (or workspace admins) to define **custom field schemas** that attach
to records like standups, tickets, or any future entity. The fields themselves
are defined once and then instances carry their values.

Rough mental model:

```
FieldSchema (team-scoped)
  id, teamId, entityType, name, type, options?, required?

FieldValue (per-record)
  recordId, fieldSchemaId, value
```

Field types to consider: `text`, `number`, `select`, `multi-select`, `date`,
`user`, `boolean`, `url`

---

## Motivating Use Case: Daily Standups

A scrum master wants every team member to answer three questions each morning:

- What did you do yesterday?
- What are you doing today?
- Any blockers?

But *another* team might want five questions. Or they might want a mood rating
(1–5). Or a link to the JIRA ticket they're working on. Without custom fields,
every variation requires a new feature request.

With custom fields, the scrum master defines the standup schema once for their
team. The standup UI renders it dynamically. The dashboard aggregates the
responses using the same field definitions.

---

## Prior Art to Draw From

| Product | What it does well |
|---------|------------------|
| **Asana** | Custom fields per project, typed, filterable in reports |
| **GitHub Projects** | Column types (text, number, date, select) per board |
| **Notion** | Database properties — extremely flexible, maybe too much |
| **Airtable** | Field types with validation, rollups across linked records |

We don't need Airtable's full power. Asana's project-level custom fields are
probably the right scope to aim for — team-scoped, typed, optional/required,
with a reasonable set of field types.

---

## Open Questions

- **Where does the schema live?** Per-team? Per-feature? Global with team override?
- **Who can define schemas?** Admins only, or any team member?
- **Validation** — enforced on the client, server, or both?
- **Reporting** — can custom fields be aggregated/filtered on dashboards?
- **Migration** — when a schema changes, what happens to existing records?
- **Limits** — max fields per entity? Max options per select field?

---

## Possible Rollout Sequence

1. **Proof of concept on Standups** — define standup questions as custom fields
   for a single team; render them dynamically in the standup UI
2. **Schema editor UI** — team admin can add/edit/remove fields without code
3. **Dashboard widgets** — aggregate custom field values (e.g., blockers count,
   mood trend over the week)
4. **Generalize to other entities** — tickets, retrospectives, 1-on-1s, etc.

---

## Risks

- **Complexity creep**: Free-form data models can become a product in themselves.
  Scope must be kept tight to the team's actual workflow needs.
- **Performance**: Querying across arbitrary field values needs careful indexing
  (MongoDB sparse indexes or a separate values collection).
- **UX burden**: Putting schema authoring in users' hands requires a thoughtful
  editor — bad UX here will kill adoption.
