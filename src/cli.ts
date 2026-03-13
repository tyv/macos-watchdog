#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig, type Config } from "./config.js";
import { startMonitor } from "./monitor.js";
import { generateReport } from "./reporter.js";

const execFileAsync = promisify(execFile);

const GITHUB_REPO = "tyv/macos-watchdog";
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download/macos-watchdog.tar.gz`;

// ── Helpers ────────────────────────────────────────────────

function usage(): never {
  console.log(`
  macos-watchdog — lightweight macOS resource monitor

  USAGE
    watchdog start   [options]    Start the monitoring daemon (foreground)
    watchdog stop                 Stop the running daemon
    watchdog status               Show daemon status
    watchdog install               Install as launchd service (auto-start on boot)
    watchdog uninstall             Remove launchd service
    watchdog report  [options]    Generate a report from logs
    watchdog help                 Show this help

  START OPTIONS
    --interval <sec>       Sampling interval (default: 30)
    --cpu-threshold <pct>  Per-process CPU alert threshold (default: 80)
    --mem-pressure <level> Memory pressure to alert on: warn or critical (default: warn)
                           warn = yellow + red, critical = red only

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
  if (args.has("--mem-pressure")) {
    const val = args.get("--mem-pressure")!;
    if (val !== "warn" && val !== "critical") {
      console.error(`Invalid --mem-pressure value: "${val}". Use "warn" or "critical".`);
      process.exit(1);
    }
    overrides.memPressureAlert = val;
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

// ── Launchd ────────────────────────────────────────────────

const PLIST_LABEL = "com.watchdog.monitor";

function plistDir(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

function plistPath(): string {
  return path.join(plistDir(), `${PLIST_LABEL}.plist`);
}

function resolveNodeBin(): string {
  try {
    return fs.realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

function cliJsPath(): string {
  return path.resolve(
    new URL(import.meta.url).pathname.replace(/\.js$/, ".js"),
  );
}

function buildPlist(nodeBin: string, cliJs: string, home: string): string {
  const baseDir = process.env.WATCHDOG_HOME ?? path.join(home, ".macos-watchdog");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${cliJs}</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${baseDir}/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${baseDir}/launchd-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;
}

function versionFilePath(): string {
  const baseDir =
    process.env.WATCHDOG_HOME ??
    path.join(os.homedir(), ".macos-watchdog");
  return path.join(baseDir, "installed-release");
}

function binDir(): string {
  return path.join(os.homedir(), ".macos-watchdog-bin");
}

function getInstalledRelease(): string | null {
  try {
    return fs.readFileSync(versionFilePath(), "utf-8").trim();
  } catch {
    return null;
  }
}

function httpGetJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "macos-watchdog" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          httpGetJson(res.headers.location!).then(resolve, reject);
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as Record<string, unknown>);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function fetchLatestRelease(): Promise<string | null> {
  try {
    const data = await httpGetJson(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    );
    return (data.tag_name as string) ?? null;
  } catch {
    return null;
  }
}

function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase().startsWith("y"));
    });
  });
}

async function downloadAndExtract(destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync("bash", [
    "-c",
    `curl -fsSL "${DOWNLOAD_URL}" | tar -xz -C "${destDir}"`,
  ]);
}

async function cmdInstall(): Promise<void> {
  const dest = plistPath();
  const nodeBin = resolveNodeBin();
  let cliJs = cliJsPath();
  const home = os.homedir();

  // Check for updates
  console.log("Checking for latest release...");
  const latestTag = await fetchLatestRelease();
  const installedTag = getInstalledRelease();

  if (latestTag) {
    if (installedTag && installedTag === latestTag) {
      console.log(`Already on latest release: ${latestTag}`);
    } else if (installedTag) {
      console.log(`Update available: ${installedTag} → ${latestTag}`);
      const yes = await promptYesNo("Download and install update? [y/N] ");
      if (yes) {
        console.log("Downloading...");
        await downloadAndExtract(binDir());
        fs.mkdirSync(path.dirname(versionFilePath()), { recursive: true });
        fs.writeFileSync(versionFilePath(), latestTag, "utf-8");
        cliJs = path.join(binDir(), "dist", "cli.js");
        console.log(`Updated to ${latestTag}`);
      }
    } else {
      // First install — offer pre-built download
      console.log(`Latest release: ${latestTag}`);
      const yes = await promptYesNo(
        "Download pre-built release to ~/.macos-watchdog-bin? [y/N] ",
      );
      if (yes) {
        console.log("Downloading...");
        await downloadAndExtract(binDir());
        fs.mkdirSync(path.dirname(versionFilePath()), { recursive: true });
        fs.writeFileSync(versionFilePath(), latestTag, "utf-8");
        cliJs = path.join(binDir(), "dist", "cli.js");
        console.log(`Installed ${latestTag}`);
      }
    }
  } else {
    console.log("Could not reach GitHub to check for updates (offline?).");
    console.log("Continuing with local version.");
  }

  console.log("");

  // Unload existing if present
  if (fs.existsSync(dest)) {
    try {
      await execFileAsync("launchctl", ["unload", dest]);
    } catch {}
  }

  fs.mkdirSync(plistDir(), { recursive: true });
  fs.writeFileSync(dest, buildPlist(nodeBin, cliJs, home), "utf-8");

  await execFileAsync("launchctl", ["load", dest]);

  console.log("Watchdog installed as launchd service.");
  console.log(`  Plist: ${dest}`);
  console.log(`  Node:  ${nodeBin}`);
  console.log(`  CLI:   ${cliJs}`);
  console.log("");
  console.log("It will start automatically on boot and is running now.");
}

async function cmdUninstall(): Promise<void> {
  const dest = plistPath();
  if (!fs.existsSync(dest)) {
    console.log("Watchdog launchd service is not installed.");
    return;
  }

  try {
    await execFileAsync("launchctl", ["unload", dest]);
  } catch {}
  fs.unlinkSync(dest);

  console.log("Watchdog launchd service removed.");
  console.log("Logs and reports in ~/.macos-watchdog/ are kept.");
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
  case "install":
    cmdInstall().catch((e) => { console.error(e.message); process.exit(1); });
    break;
  case "uninstall":
    cmdUninstall().catch((e) => { console.error(e.message); process.exit(1); });
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
