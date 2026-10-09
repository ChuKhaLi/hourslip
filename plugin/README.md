# hourslip

Billable hours per client and ticket, measured from your Claude Code sessions. hourslip records when you
work, gives the time to a client by the folder you are in and to a ticket by the git branch, and exports
a timesheet as CSV plus an HTML report you can print to PDF or publish as a link for your client.

hourslip works in Claude Code only: it is a mod (a plugin of function hooks), and claude.ai chat runs no
hooks. Built and tested on Claude Code 2.1.289 and later, on Windows; macOS and Linux have not been checked.
Site, sample report and Pro: https://hourslip.dev

## Install

    claude plugin marketplace add ChuKhaLi/hourslip
    claude plugin install hourslip@hourslip

## First setup

    /hourslip client add acme "ACME Corp" --path "F:/work/acme/**" --rate 40 USD

Work in a folder that matches the path and the time goes to `acme`. A ticket is read from the git branch:
`feature/ACME-123-login` gives `ACME-123`.

## Commands

- `/hourslip`: this week, in a pane; the status line shows today's total.
- `/hourslip tag <client> [ticket] [--session]`: give this session to a client.
- `/hourslip add <1h30> <client> "<note>" [--date YYYY-MM-DD] [--ticket X]`: time outside Claude Code, labelled as added by hand.
- `/hourslip client add <id> "<name>" --path <glob> [--rate <amount> <CUR>]`: a client and its folders.
- `/hourslip export [client] [YYYY-MM]`: CSVs and an HTML preview in `~/.hourslip/exports/`.
- `/hourslip publish <client> [YYYY-MM] [--no-commits]`: a preview of the client report; sends nothing.
  Add `--confirm` to publish it as a link. The first two reports are free.
- `/hourslip unpublish <client> <YYYY-MM>`: delete a published report.
- `/hourslip subscribe [--monthly]`, `/hourslip portal`: buy or manage Pro.
- `/hourslip key | key show | key set <key> | key forget`: the key that owns your published reports.
- `/hourslip import [--confirm | --undo]`: sessions from before you installed hourslip, found in Claude
  Code's transcripts. Without `--confirm` it only reports what it found.
- `/hourslip tz`: the timezone offset hourslip records.

## What it runs

`hooks/register.tsx` registers function hooks on session start, prompt submit, turn start, turn
complete and session end. Each appends one line (a timestamp, the timezone offset, the session id, the
kind of event, the working folder, the git branch read from `.git/HEAD`, turn ids) to
`~/.hourslip/events/<session id>.jsonl` and redraws the status line. A hook never blocks or changes a
turn, and never records prompt text, replies or file contents.

The `/hourslip` command runs other programs only by argv, never through a shell:

- `git config user.name` and `git log --format=%s` in your client folders, for commit titles in exports
  and reports (`--no-commits` leaves them out of a published report);
- `uname`, then `rundll32 url.dll,FileProtocolHandler`, `open` or `xdg-open`, to open a Dodo Payments
  checkout or portal link in your browser (only links on Dodo Payments' hosts are opened);
- `cmd /d /v:off /c type <file>` or `cat <file>` during `/hourslip import`, to read a transcript over
  4 MiB, which Claude Code's file reader refuses.

## Network and data

Everything hourslip records stays in `~/.hourslip` (or `HOURSLIP_HOME`) on your machine. It has no
telemetry and makes no network call while you work.

The only server it talks to is `https://r.hourslip.dev` (or `HOURSLIP_SERVER`, which must be https),
and only from these commands:

- `/hourslip publish ... --confirm`: sends the report you previewed: your business name and payment
  instructions, the client's name, hours per day and per ticket, ticket and branch names, commit titles
  (unless `--no-commits`), notes you added by hand, and the invoice amount when the client has a rate.
  On the first publish it also asks the server for a free key (`POST /keys/free`, no data sent).
- `/hourslip unpublish`: deletes that report on the server.
- `/hourslip subscribe` and `/hourslip portal`: ask the server for a Dodo Payments checkout or portal
  link. hourslip never talks to Dodo Payments itself; the server does.
- `/hourslip key` and `/hourslip key set <key>`: ask the server about the key.
- `/hourslip` (the weekly pane), once you have published: asks the server for the status of reports you
  published that are not yet confirmed (at most 20; it stops at the first failure).

Each call carries your key as a Bearer token; it is stored by Claude Code for this plugin, never in a file
under `~/.hourslip`. The server keeps a published report for 2 years, or until you unpublish it; it
stores a hash of the key, never the key. Full policy: https://hourslip.dev/privacy

`/hourslip import` reads Claude Code's transcripts on your machine (under `CLAUDE_CONFIG_DIR`, else
`~/.claude`, in `projects/`) and keeps only times, session ids, folders and branches, never prompt
text. With `--confirm` it writes the sessions in your clients' folders to `~/.hourslip/imported/` and
keeps a scan cache in `~/.hourslip/import-cache/` (the same fields, for every Claude Code session on this
machine). `--undo` removes both. Nothing it reads is sent anywhere.

## License

FSL-1.1-MIT: read it, change it, use it for yourself or your company; do not build a competing product
with it. Each version becomes MIT two years after its release. Source: https://github.com/ChuKhaLi/hourslip
