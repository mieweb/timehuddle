# Market Research — TimeHuddle

## Purpose

These documents contain question sets for collecting market research from the
three primary personas TimeHuddle is being designed for. The goal is to
validate (or invalidate) the hypotheses in [../plans/README.md](../plans/README.md)
with data from real people before committing to building.

## Design Principles

- **One form per persona** — scrum master questions are completely different
  from HR questions. Mixing them produces muddy data and a bad respondent
  experience.
- **Ask about pain, not features** — "would you use X?" is not useful. People
  say yes to features. "What's the worst part of doing X today?" tells you if
  the problem is real.
- **Keep it under 10 minutes** — aim for 8–12 questions per form. Completion
  rates drop sharply after 10 minutes.

## Forms

| File | Persona | Primary hypothesis to validate |
|------|---------|-------------------------------|
| [team-member.md](team-member.md) | Individual contributor / team member | Standup friction and visibility pain are real |
| [scrum-master.md](scrum-master.md) | Scrum master / team lead | Capacity planning is done manually and is painful |
| [hr-payroll.md](hr-payroll.md) | HR / payroll / finance | Timesheet collection and payroll re-entry are major pain points |
| [developer.md](developer.md) | Full stack / software developer | Tool-switching friction and poor ticket↔time attribution are real pain points; GitHub integration and AI standup drafting have appetite |
| [first-robotics.md](first-robotics.md) | FIRST Robotics coach / lead mentor | Build season coordination, student hour tracking, and award documentation are underserved by existing tools |

## How to Use These

1. Create a Google Form for each persona
2. Copy questions in order — section breaks map to Google Form sections
3. Share targeted links: don't send the scrum master form to individual
   contributors
4. Aim for at least 10–15 responses per persona before drawing conclusions
5. Record findings back in this directory as `findings-[persona].md` once
   responses are collected
