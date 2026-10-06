# hourslip

Billable hours per client and ticket, measured from your Claude Code sessions. hourslip is a Claude
Code mod (a plugin of function hooks). It records when you work, attributes the time to a client by
the folder you are in and to a ticket by the git branch, and exports a timesheet as CSV plus an HTML
report you can print to PDF.

Site and sample report: https://hourslip.dev. This repository is the public mirror of hourslip's source,
published under FSL-1.1-MIT (see LICENSE.md).

Measured from Claude Code activity. Time outside Claude Code, such as meetings or manual testing, appears only where it was added by hand, and is labelled so.

## Install

    claude plugin marketplace add ChuKhaLi/hourslip
    claude plugin install hourslip@hourslip

Mods are on by default in current Claude Code (checked on 2.1.291); nothing to enable.

## First setup

    /hourslip client add acme "ACME Corp" --path "F:/work/acme/**" --rate 40 USD

Work in a folder that matches the path and the time goes to `acme`. A ticket is read from the git
branch, for example `feature/ACME-123-login` gives `ACME-123`.

## Commands

```
Usage:
  /hourslip                                   this week
  /hourslip tag <client> [ticket] [--session] attribute this session
  /hourslip add <1h30> <client> "<note>" [--date YYYY-MM-DD] [--ticket X]
  /hourslip client add <id> "<name>" --path <glob> [--path <glob>] [--rate <amount> <CUR>]
  /hourslip export [client] [YYYY-MM]
  /hourslip tz                                the timezone offset hourslip records
```

`export` writes `hourslip-<client or all>-<month>-days.csv` and `-tickets.csv` into `~/.hourslip/exports/`. With a
client it also writes an HTML preview of the client report, with commit titles per ticket when
available. The preview says what it lacks in a banner at the top (hidden when printed): commit titles
unavailable for N branches, N unreadable event lines skipped, N unreadable manual lines skipped, and the
days with overlapping clients. The same notes are printed after the paths.

The days CSV has a "Measured hours" column (from Claude Code activity), "Manual hours" (added by hand)
and "Total billable hours" (the two together).

## Where the data lives

`~/.hourslip` (or the folder in `HOURSLIP_HOME`):

- `events/<sessionid>.jsonl`: one file per session
- `manual.jsonl`: time added by hand with `/hourslip add`
- `rules.json`: your clients and settings
- `exports/`: CSVs and previews

### rules.json

```json
{
  "business": { "name": "", "paymentInstructions": "" },
  "ticketPattern": "[A-Z][A-Z0-9]+-T?\\d+",
  "csv": "en",
  "author": null,
  "tzOffsetMinutes": null,
  "clients": [
    {
      "id": "acme",
      "name": "ACME Corp",
      "paths": ["F:/work/acme/**"],
      "rate": { "amount": 40, "currency": "USD" },
      "ticketPattern": null
    }
  ]
}
```

- `csv`: `"en"` (comma separator, decimal point) or `"vi"` (semicolon separator, decimal comma). Both
  write UTF-8 with a BOM, 2-decimal hours and CRLF line ends.
- `author`: restricts commit titles to this git author; null means your `git config user.name`.
- `tzOffsetMinutes`: overrides the zone hourslip records (null means the host zone). `/hourslip tz`
  shows what is in use. A hand-edited `rules.json` that is not valid JSON makes all time Unassigned
  and shows the error with a line number; nothing is lost.
- Path globs match with forward or back slashes and, for Windows paths, ignoring case.

## What is recorded

Per event: a timestamp, the timezone offset, the session id, the kind of event (start, prompt, turn
start/end, end, tag), `cwd`, the git branch (read from `.git/HEAD`), turn ids and, on a turn-end line,
the subagent id (`agent`) when a subagent's turn ended. Never prompt text
or file contents. Nothing leaves your machine.

## How time is counted

- A gap of more than 45 minutes between events splits activity into stretches.
- A stretch lasts its span plus 10 minutes. A lone prompt counts 10 minutes.
- Opening Claude Code alone (session start) records nothing billable.
- Two windows on the same client count once.
- Overlapping time on different clients is split between them and flagged. Time with no client
  (Unassigned) never competes: it is not split, not flagged, and keeps its own full time.
- Minutes are rounded per day and client so the rows add up to that client's total.
- Measured time per day is capped at 12 hours over assigned clients (Unassigned and time added by hand
  are not capped).
- A stretch also ends at the session's end event if that comes before the 10-minute pad.
- A stretch that crosses midnight belongs to the day it started.

## Known limits

- Hours exist only for time spent in Claude Code with the mod loaded. A session where an
  organization policy disables mods records nothing, and the pane cannot know that.
- Event timestamps come from your clock and are trusted. A client who doubts the hours is shown a
  lower bound, not a tamper-proof record.
- Commit titles appear only on the CLI (they are read with `git` through `process.run`). Elsewhere,
  such as the desktop app, the report says they are unavailable.
- Checked only on Windows. macOS and Linux have not been checked.
- A session's event file is rewritten whole after each event. The engine's declaration for `$.fs`
  says: "A read or write over 4 MiB rejects" and, for read, "Rejects when missing, or over 4 MiB". A
  session file past 4 MiB therefore cannot be read back (after a reload, or by the pane and export),
  so its earlier time would be missing, and a write that large fails (status line `⏱ !` and a
  toast). This limit was not exercised in testing.

## Development

    pnpm test        # core, Vitest
    pnpm typecheck
    pnpm test:mod    # hooks module through Claude Code's own kit

`test:mod` typechecks against the engine's declarations, which Claude Code writes under
`plugin/.claude-plugin/types/` when it loads the plugin. Lay them once on a fresh checkout, from the
repository root (no model call; it prints `hourslip: hourslip is loaded.`):

    claude -p --plugin-dir ./plugin "/hourslip"

## License

FSL-1.1-MIT. See `LICENSE.md`.
