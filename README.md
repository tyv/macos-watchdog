# macos-watchdog

A lightweight CLI tool that monitors CPU and memory usage on macOS, logs resource hogs, and generates readable reports.

**Zero runtime dependencies** — uses only Node.js built-ins and the native `ps` command.

---

## Install (pre-built, no build step)

Every push to `main` triggers a GitHub Actions build that publishes a ready-to-run release. Just download and go:

```bash
mkdir -p ~/.macos-watchdog-bin \
  && curl -fsSL https://github.com/tyv/macos-watchdog/releases/latest/download/macos-watchdog.tar.gz \
     | tar -xz -C ~/.macos-watchdog-bin
```

Then run it:

```bash
node ~/.macos-watchdog-bin/dist/cli.js start
```

Optionally alias it in your shell profile (`~/.zshrc`):

```bash
alias watchdog="node ~/.macos-watchdog-bin/dist/cli.js"
```

To update, just re-run the curl command above.

## Build from source

```bash
git clone git@github.com:tyv/macos-watchdog.git
cd macos-watchdog
npm install
npm run build
```

## Quick start

```bash
# Run the monitor (foreground)
node dist/cli.js start

# Check status
node dist/cli.js status

# Generate a report for the last 24 hours
node dist/cli.js report --last 24h
```

## How it works

1. Every **30 seconds** (configurable), the watchdog samples all running processes via `ps`.
2. If any single process exceeds the **CPU threshold** (default 80%) or **memory threshold** (default 50%), an alert is written to a structured JSONL log file.
3. A snapshot with system-wide stats and the top 5 processes (by CPU and memory) is always logged, even if nothing breaches the threshold.
4. Logs are stored as one file per day: `~/.macos-watchdog/logs/watchdog-YYYY-MM-DD.jsonl`
5. The `report` command reads these logs and produces a Markdown report with tables, rankings, and a timeline.

## Commands

### `start` — start monitoring

```bash
node dist/cli.js start [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--interval <sec>` | `30` | How often to sample (seconds) |
| `--cpu-threshold <pct>` | `80` | Per-process CPU % to trigger an alert |
| `--mem-threshold <pct>` | `50` | Per-process memory % to trigger an alert |

Press `Ctrl+C` to stop, or use the `stop` command from another terminal.

### `stop` — stop the daemon

```bash
node dist/cli.js stop
```

Sends SIGTERM to the running watchdog process.

### `status` — check if running

```bash
node dist/cli.js status
```

### `report` — generate a report

```bash
node dist/cli.js report [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--from <YYYY-MM-DD>` | today | Start date |
| `--to <YYYY-MM-DD>` | today | End date |
| `--last <period>` | — | Shorthand: `1h`, `6h`, `24h`, `7d`, `30d` (overrides `--from`) |
| `--out <dir>` | `~/.macos-watchdog/reports` | Where to save the report |

Example: generate a report for the last week:

```bash
node dist/cli.js report --last 7d
```

Example: generate a report for a specific range:

```bash
node dist/cli.js report --from 2026-03-01 --to 2026-03-13
```

Reports are saved as Markdown files in the output directory.

## Running in the background

### Option A: Simple background process

```bash
nohup node dist/cli.js start > /dev/null 2>&1 &
```

### Option B: macOS launchd (recommended — survives reboots)

```bash
# Install the launch agent
./install.sh

# Load (start) the service
launchctl load ~/Library/LaunchAgents/com.watchdog.monitor.plist

# Unload (stop) the service
launchctl unload ~/Library/LaunchAgents/com.watchdog.monitor.plist
```

The installer auto-detects your `node` path and writes a personalised plist.

## File locations

| What | Path |
|------|------|
| Logs | `~/.macos-watchdog/logs/` |
| Reports | `~/.macos-watchdog/reports/` |
| PID file | `~/.macos-watchdog/watchdog.pid` |
| launchd stdout | `~/.macos-watchdog/launchd-stdout.log` |
| launchd stderr | `~/.macos-watchdog/launchd-stderr.log` |

Override the base directory by setting `WATCHDOG_HOME`:

```bash
WATCHDOG_HOME=/tmp/my-watchdog node dist/cli.js start
```

## Sample report output

```
# Watchdog Report

**Period:** 2026-03-13 09:18 → 2026-03-13 10:18

## Overview

| Metric           | Value  |
|------------------|--------|
| Total snapshots  | 4      |
| CPU alerts       | 4      |
| Memory alerts    | 0      |
| Avg CPU load     | 115.5% |
| Peak CPU load    | 165.1% |

## Top CPU Offenders

| Process          | Alerts | Avg CPU% | Peak CPU% |
|------------------|--------|----------|-----------|
| zoom.us          | 4      | 61.9%    | 72.7%     |
| WindowServer     | 4      | 57.1%    | 87.3%     |
```

## Project structure

```
src/
  cli.ts        CLI entry point — parses commands and options
  config.ts     Default thresholds, paths, and config resolution
  sampler.ts    Reads process list via `ps`, computes system stats
  logger.ts     Writes/reads JSONL log files (one per day)
  monitor.ts    Periodic sampling loop, threshold checking, alerting
  reporter.ts   Reads logs and generates Markdown reports
```

## Requirements

- macOS (uses `ps` with macOS-specific flags)
- Node.js 18+
- TypeScript 5+ (only needed if building from source)
