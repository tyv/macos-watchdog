# macos-watchdog

A lightweight CLI tool that monitors CPU and memory usage on macOS, logs resource hogs, and generates readable reports.

**Zero runtime dependencies** — uses only Node.js built-ins and native macOS commands (`ps`, `sysctl`).

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

### Updating

To update to the latest version, stop the running daemon and re-run the same install command:

```bash
node ~/.macos-watchdog-bin/dist/cli.js stop
mkdir -p ~/.macos-watchdog-bin \
  && curl -fsSL https://github.com/tyv/macos-watchdog/releases/latest/download/macos-watchdog.tar.gz \
     | tar -xz -C ~/.macos-watchdog-bin
```

Your logs and reports in `~/.macos-watchdog/` are kept — only the binary is replaced.

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

1. Every **30 seconds** (configurable), the watchdog samples all running processes via `ps` and reads macOS memory pressure via `sysctl`.
2. **CPU alerts**: if any single process exceeds the CPU threshold (default 80%), an alert is logged with the offending processes.
3. **Memory alerts**: uses macOS **memory pressure** (the same metric behind Activity Monitor's green/yellow/red gauge) instead of raw RAM usage. macOS always uses ~100% of RAM for caching — that's normal. Alerts fire only when pressure is yellow (warn) or red (critical), meaning the system is actually struggling. The top memory consumers and swap usage are logged.
4. A snapshot with system-wide stats (CPU, memory pressure, swap, top processes) is always logged, even when nothing triggers.
5. Logs are stored as one file per day: `~/.macos-watchdog/logs/watchdog-YYYY-MM-DD.jsonl`
6. The `report` command reads these logs and produces a Markdown report with tables, rankings, and a timeline.

## Commands

### `start` — start monitoring

```bash
node dist/cli.js start [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--interval <sec>` | `30` | How often to sample (seconds) |
| `--cpu-threshold <pct>` | `80` | Per-process CPU % to trigger an alert |
| `--mem-pressure <level>` | `warn` | Memory pressure to alert on: `warn` (yellow+red) or `critical` (red only) |

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

| Metric                           | Value  |
|----------------------------------|--------|
| Total snapshots                  | 120    |
| CPU alerts                       | 4      |
| Memory pressure warnings (yellow)| 12     |
| Memory pressure critical (red)   | 0      |
| Avg CPU load                     | 42.3%  |
| Peak CPU load                    | 165.1% |
| Lowest memory pressure level     | 18     |
| Peak swap usage                  | 11750MB|

## Top CPU Offenders

| Process      | Alerts | Avg CPU% | Peak CPU% |
|--------------|--------|----------|-----------|
| zoom.us      | 4      | 61.9%    | 72.7%     |
| WindowServer | 4      | 57.1%    | 87.3%     |

## Top Memory Consumers (during pressure)

| Process                 | Seen in alerts | Avg Mem% | Peak Mem% |
|-------------------------|----------------|----------|-----------|
| Cursor Helper (Renderer)| 12             | 4.2%     | 5.1%      |
| idea                    | 10             | 2.4%     | 3.0%      |
```

## Project structure

```
src/
  cli.ts        CLI entry point — parses commands and options
  config.ts     Default thresholds, paths, and config resolution
  sampler.ts    Reads process list via `ps`, memory pressure via `sysctl`
  logger.ts     Writes/reads JSONL log files (one per day)
  monitor.ts    Periodic sampling loop, threshold checking, alerting
  reporter.ts   Reads logs and generates Markdown reports
```

## Requirements

- macOS (uses `ps` with macOS-specific flags)
- Node.js 18+
- TypeScript 5+ (only needed if building from source)
