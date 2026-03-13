#!/usr/bin/env node

import fs from "node:fs";
import { resolveConfig, type Config } from "./config.js";
import { startMonitor } from "./monitor.js";
import { generateReport } from "./reporter.js";

// ── Helpers ────────────────────────────────────────────────

function usage(): never {
  console.log(`
  macos-watchdog — lightweight macOS resource monitor

  USAGE
    watchdog start   [options]    Start the monitoring daemon
    watchdog stop                 Stop the running daemon
    watchdog status               Show daemon status
    watchdog report  [options]    Generate a report from logs
    watchdog help                 Show this help

  START OPTIONS
    --interval <sec>       Sampling interval (default: 30)
    --cpu-threshold <pct>  Per-process CPU alert threshold (default: 80)
    --mem-threshold <pct>  System-wide memory % alert threshold (default: 90)

  REPORT OPTIONS
    --from <YYYY-MM-DD>    Start date (default: today)
    --to   <YYYY-MM-DD>    End date   (default: today)
    --last <period>        Shorthand: 1h, 6h, 24h, 7d, 30d (overrides --from)
    --out  <dir>           Output directory for the report

  ENVIRONMENT
    WATCHDOG_HOME          Base directory (default: ~/.macos-watchdog)
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        map.set(key, next);
        i++;
      } else {
        map.set(key, "true");
      }
    }
  }
  return map;
}

function parseDate(value: string): Date {
  const d = new Date(value + "T00:00:00");
  if (isNaN(d.getTime())) {
    console.error(`Invalid date: ${value}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  return d;
}

function resolveLast(period: string): Date {
  const now = Date.now();
  const match = period.match(/^(\d+)(h|d)$/);
  if (!match) {
    console.error(`Invalid --last value: "${period}". Examples: 1h, 6h, 24h, 7d, 30d`);
    process.exit(1);
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const ms = unit === "h" ? n * 3600_000 : n * 86_400_000;
  return new Date(now - ms);
}

// ── Commands ───────────────────────────────────────────────

function cmdStart(args: Map<string, string>): void {
  const overrides: Partial<Config> = {};

  if (args.has("--interval")) {
    overrides.intervalSec = parseInt(args.get("--interval")!, 10);
  }
  if (args.has("--cpu-threshold")) {
    overrides.cpuThreshold = parseInt(args.get("--cpu-threshold")!, 10);
  }
  if (args.has("--mem-threshold")) {
    overrides.memThreshold = parseInt(args.get("--mem-threshold")!, 10);
  }

  const config = resolveConfig(overrides);
  startMonitor(config);
}

function cmdStop(): void {
  const config = resolveConfig();
  if (!fs.existsSync(config.pidFile)) {
    console.log("Watchdog is not running (no PID file found).");
    process.exit(0);
  }
  const pid = parseInt(fs.readFileSync(config.pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to PID ${pid}.`);
  } catch (err: any) {
    if (err.code === "ESRCH") {
      console.log(`Process ${pid} not found. Cleaning up stale PID file.`);
      fs.unlinkSync(config.pidFile);
    } else {
      throw err;
    }
  }
}

function cmdStatus(): void {
  const config = resolveConfig();
  if (!fs.existsSync(config.pidFile)) {
    console.log("Watchdog is not running.");
    return;
  }
  const pid = parseInt(fs.readFileSync(config.pidFile, "utf-8").trim(), 10);
  try {
    process.kill(pid, 0); // signal 0 = check if alive
    console.log(`Watchdog is running (PID ${pid}).`);
    console.log(`  Logs: ${config.logDir}`);
  } catch {
    console.log(`Watchdog is not running (stale PID file for ${pid}).`);
    fs.unlinkSync(config.pidFile);
  }
}

function cmdReport(args: Map<string, string>): void {
  const config = resolveConfig();
  const reportDir = args.get("--out") ?? config.reportDir;

  let from: Date;
  let to: Date;

  if (args.has("--last")) {
    from = resolveLast(args.get("--last")!);
    to = new Date();
  } else {
    const today = new Date().toISOString().slice(0, 10);
    from = parseDate(args.get("--from") ?? today);
    to = parseDate(args.get("--to") ?? today);
    to = new Date(to.getTime() + 86_400_000 - 1); // end of day UTC
  }

  console.log(`Generating report for ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}...`);
  const filePath = generateReport(config.logDir, reportDir, from, to);
  console.log(`Report saved to: ${filePath}`);
}

// ── Main ───────────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case "start":
    cmdStart(args);
    break;
  case "stop":
    cmdStop();
    break;
  case "status":
    cmdStatus();
    break;
  case "report":
    cmdReport(args);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    usage();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    usage();
}
