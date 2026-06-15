# Organizations And Enterprises

> **STATUS: IMPLEMENTED FOUNDATION** — The enterprise, organization,
> membership, org-scoped team, org chart, and basic admin-management foundation
> exists in the product. This document describes the current model and the
> remaining higher-level roadmap.

## Current Product Reality

Huddle now has three separate but related identity and ownership layers:

- **User identity** — a globally unique user handle/profile.
- **Personal workspace** — an auto-provisioned personal team/workspace so every user has somewhere to land immediately after signup.
- **Enterprise / Organization hierarchy** — a company-level management layer above collaborative teams.

The current model is no longer team-only. Teams belong to organizations, and
organizations can belong to enterprises.

```
Enterprise
  └── Organization
        └── Team
              └── Team members

User
  ├── Profile / handle
  ├── Personal workspace
  └── Organization memberships
```

This means the original goal of adding the org boundary early has been met. The remaining work is not "should orgs exist?" but "which higher-level org features should be built on top of the foundation?"

---

## What Exists Today

### Enterprises

An **Enterprise** is the top-level administrative container.

It currently has:

- name
- slug
- owners
- admins
- create / list / detail / rename flows
- owner/admin membership management
- user search for adding enterprise admins or owners

Enterprise admins and owners can manage organizations under the enterprise.

### Organizations

An **Organization** is the operating container for teams.

It currently has:

- enterprise association
- name
- slug
- owner/admin/member roles
- auto-join setting
- member list
- member role management
- member removal
- organization user search
- organization detail and settings flows
- organization chart data
- reports-to assignment for org members

Organizations are visible in the app as selectable work contexts. Teams are filtered by selected organization context.

### Organization Membership

Organization membership is represented separately from team membership.

Roles:

| Role | Current meaning |
|------|-----------------|
| `owner` | Elevated organization role; can manage organization membership and settings |
| `admin` | Elevated organization role; can manage organization membership and settings |
| `member` | Belongs to the organization and can participate through assigned teams |

Memberships also track whether a member was added automatically.

### Teams

Teams are now org-scoped.

Each team has:

- `orgId`
- optional `parentTeamId`
- members
- admins
- optional `isPersonal`

Team creation happens within an accessible organization. Joining or being added to a team also ensures organization membership where appropriate.

### Reporting Lines / Org Chart

Users can have a `reportsToUserId`, and organization members can be displayed in an org chart.

This is intentionally lightweight. It is not a full HRIS org-chart system yet, but it supports the basic question: "Who does this person report to?"

---

## Namespace And Routing

Profiles are already namespaced by canonical username. Organization slugs also
exist, but the long-term public URL strategy is still a product decision.

Current assumptions:

- user handles are globally unique
- organization slugs are unique
- profile URLs remain centered on user handles
- organization routing can stay app-internal until public org URL strategy is finalized

Open product choices:

- `/org/{orgSlug}`
- `/{orgSlug}` with a shared user/org namespace
- subdomains such as `{orgSlug}.huddle.app`
- app-only org switching without public org pages

Because users already occupy public namespace, any future shared namespace must
use one reserved-name policy for both user handles and organization slugs.

---

## Signup And Default Context

Signup should continue to land every user in a valid working context.

Current direction:

- first signup establishes user identity
- user handle/profile remains the canonical personal identity
- personal workspace is created idempotently
- a default enterprise and default organization can exist as system bootstrap containers
- collaborative organization membership is additive, not required for basic onboarding

This keeps onboarding simple while preserving the enterprise/org structure for
companies, departments, and multi-team work.

---

## What Organizations Unlock

The foundation now supports several future product surfaces:

| Feature | Why it depends on orgs |
|---------|------------------------|
| Org-wide reporting | Query across all teams in one organization |
| Enterprise administration | Manage multiple organizations under one company-level container |
| Shared member directory | One place to see people across teams |
| Org chart | Display reporting lines across organization members |
| Capacity planning | Roll up availability and allocation across teams |
| Payroll/export flows | Export hours across organization members and teams |
| SSO / domain join | Map identity provider domains to organizations |
| Billing | Charge by organization or enterprise seats instead of team-by-team |

The first several pieces are already supported structurally. Reporting,
capacity, SSO, billing, and payroll-specific behavior still need their own
feature work.

---

## Current Limits

The current implementation is a foundation, not the full enterprise product.

Still future:

- org billing and seat-counting
- SSO/domain mapping
- Google Workspace directory sync
- SCIM provisioning
- shared holiday calendars
- org-level capacity timeline
- org-level report registry
- payroll configuration and ADP export
- public organization profile/pages
- complete reserved-name policy for org slugs
- richer audit/compliance surface

---

## Google Workspace And SSO Future

Google Workspace remains the most likely first SSO target.

Expected shape:

- org admin connects a Google Workspace domain to an organization
- users signing in with that domain can be routed to or invited into the org
- directory sync can pre-populate members
- calendar sync can later feed time-off and blocked-time planning

Technical direction:

```
Google Workspace Admin Console
  └── OAuth / domain authorization
        └── Better Auth Google provider
              └── Huddle organization SSO config
```

Future enterprise extensions:

- Microsoft Entra ID / Azure AD
- SAML 2.0 / OIDC
- SCIM provisioning
- automatic deactivation when users leave the identity provider

---

## Relationship To Other Plans

| Plan | How orgs affect it |
|------|--------------------|
| [team-capacity.md](team-capacity.md) | Organization and enterprise rollups for availability |
| [reporting.md](reporting.md) | Org-scoped and enterprise-scoped reports |
| [exporters.md](exporters.md) | Payroll and timesheet exports across org members |
| [meetings-standups-basics.md](meetings-standups-basics.md) | Scrum masters/admins can reason across teams |
| [custom-fields.md](custom-fields.md) | Field schemas may be org-default with team overrides |
| [profiles.md](profiles.md) | Profiles and org chart share reporting-line context |

---

## Recommended Next Steps

The next useful work should build on the existing hierarchy rather than revisit
whether the hierarchy should exist.

1. **Document org permissions clearly** — define what enterprise owners/admins,
   org owners/admins, team admins, and members can do.
2. **Harden org scoping in feature specs** — new features should explicitly say
   whether they are personal, team, org, or enterprise scoped.
3. **Decide org URL strategy** — keep app-internal switching for now unless
   public org pages become a product requirement.
4. **Use orgs in reporting first** — reporting is the most immediate payoff for
   the hierarchy.
5. **Defer SSO/billing until the admin surface stabilizes** — both depend on
   accurate roles, seat ownership, and clear org context.
