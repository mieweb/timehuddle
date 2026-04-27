# Exporters Architecture

> **STATUS: PLANNING** — This document is exploratory and not yet approved for implementation. Nothing here represents a commitment or active development work.

## The Problem

As data accumulates in TimeHuddle — clock sessions, tickets, standups, capacity
blocks — teams will need to get that data *out* in formats their other tools
understand: payroll systems, spreadsheets, HR software, accounting tools. Each
destination has its own format. Without a principled exporter layer, every new
format becomes a one-off hack.

The goal is a clean, extensible exporter foundation that makes adding a new
output format a matter of implementing one interface rather than writing
bespoke controllers.

---

## Design Principle: Reports Export, Exporters Format

Exporters do not decide *what* data to include — that is the job of the
**reporting layer** (see [reporting.md](reporting.md)). An exporter receives a
normalized dataset and transforms it into a target format.

```
Report (what data, what filters)
  └──▶ Exporter (what format)
         └──▶ Output (file, stream, download)
```

This keeps business logic in reports and format logic in exporters — neither
bleeds into the other.

---

## Base Exporter Interface

```typescript
interface Exportable {
  rows: Record<string, unknown>[];
  meta: {
    title: string;
    generatedAt: Date;
    generatedBy: string;   // userId
    filters: Record<string, unknown>;
  };
}

interface Exporter {
  readonly mimeType: string;
  readonly fileExtension: string;
  export(data: ExportableRows): Promise<Buffer | string>;
}
```

All exporters implement `Exporter`. The report layer produces `ExportableRows`.
The API layer streams the result as a file download with the correct
`Content-Type` and `Content-Disposition` headers.

---

## Exporter Registry

A central registry maps format keys to exporter instances. Adding a new format
means registering a new exporter — no changes to the API or report layer.

```typescript
const exporterRegistry = new Map<string, Exporter>([
  ['csv',       new CsvExporter()],
  ['timesheet', new TimesheetCsvExporter()],
  ['adp',       new AdpCsvExporter()],
  // future: ['pdf', new PdfExporter()],
  // future: ['xlsx', new XlsxExporter()],
]);
```

The API endpoint looks like:

```
GET /v1/reports/:reportType/export?format=csv&teamId=...&startDate=...&endDate=...
```

---

## Exporter Implementations

### 1. Generic CSV Exporter

The simplest exporter. Takes any `ExportableRows` and produces a flat CSV with
headers derived from the first row's keys. Used as a fallback and for ad-hoc
data dumps.

- Column order follows key insertion order
- Values are stringified; `null`/`undefined` become empty strings
- Strings containing commas or newlines are quoted
- Uses RFC 4180 CSV format

### 2. Timesheet CSV Exporter

Specialised CSV for human-readable timesheet output. Intended for team leads
reviewing hours in a spreadsheet. Column layout:

| Column | Source |
|--------|--------|
| Date | `ClockEvent.startTimestamp` (YYYY-MM-DD) |
| Member | User display name |
| Team | Team name |
| Clock In | Start time (HH:mm) |
| Clock Out | End time (HH:mm) |
| Duration (hrs) | `accumulatedTime / 3600`, 2 decimal places |
| Tickets | Comma-separated ticket titles |
| Notes | YouTube link or freeform note |

The timesheet exporter groups rows by member then by date. It appends a
subtotal row per member and a grand total row at the end.

**Backend data source**: `ClockService.getTimesheet()` already exists and
returns the raw data this exporter needs.

### 3. ADP Workforce Now CSV Exporter

ADP payroll import format for **RUN Powered by ADP** and **ADP Workforce Now**.
Based on the ADP GTS Payroll Guide
(`https://support.adp.com/adp_payroll/content/hybrid/@runcomplete/doc/pdf/GTS_payroll_guide.pdf`).

ADP expects one row per **earnings line** per employee per pay period. The
minimum required columns for a batch payroll import are:

| ADP Column | Source | Notes |
|------------|--------|-------|
| `Co Code` | Team config | Company code assigned by ADP |
| `Batch ID` | Export meta | Date-stamped batch identifier |
| `File #` | User profile | ADP employee file number (must be configured per user) |
| `Reg Hours` | Sum of `accumulatedTime` for regular hours | Decimal hours |
| `O/T Hours` | Overtime hours (future) | 0 until OT rules are implemented |
| `Temp Dept` | Team name | Optional — maps to ADP department |

**Key constraints**:
- ADP file numbers must be stored on the user's profile (a new field)
- Only members with a configured ADP file number can be included in an export
- The export covers one pay period: weekly, biweekly, or semi-monthly (team
  config)
- Hours are rounded to 2 decimal places
- The export warns (but does not block) if a member's hours seem unusually high
  or low

**Future**: overtime detection (hours > 8/day or > 40/week), multiple earnings
codes (PTO, holiday pay), department cost codes.

---

## API Endpoints

```
GET  /v1/reports/:reportType/export
     ?format=csv|timesheet|adp
     &teamId=...
     &startDate=YYYY-MM-DD
     &endDate=YYYY-MM-DD

Response: binary file download
  Content-Type: text/csv
  Content-Disposition: attachment; filename="timehuddle-timesheet-2026-04.csv"
```

Authorization: team admin only for team-wide exports; members can export their
own data.

---

## Open Questions

- **ADP file numbers**: stored on user profile or a separate team-member config
  record?
- **Pay period config**: where does the team's payroll cadence live?
- **Overtime rules**: do we compute OT, or just export raw hours and let ADP
  handle it?
- **PDF exports**: worth adding a `PdfExporter` early, or wait for demand?
- **XLSX**: many payroll reviewers prefer Excel over CSV — future exporter?
- **Audit trail**: should exports be logged (who exported what, when)?
- **Streaming vs buffered**: for large date ranges, should exports stream to
  avoid memory pressure?

---

## Possible Rollout Sequence

1. **Base interface + registry** — `Exporter` interface, registry, API endpoint
   skeleton
2. **Generic CSV exporter** — simplest possible, validates the pipeline end-to-end
3. **Timesheet CSV exporter** — uses existing `getTimesheet()` service method
4. **ADP CSV exporter** — requires ADP file number on user profile first
5. **Audit log** — record each export (user, format, date range, team)
6. **PDF / XLSX** — additional format plugins as demand warrants
