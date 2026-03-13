import fs from "node:fs";
import path from "node:path";
import { readLogs, type LogEntry } from "./logger.js";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface ProcessStat {
  command: string;
  alertCount: number;
  maxValue: number;
  avgValue: number;
  values: number[];
}

function aggregateProcesses(
  entries: LogEntry[],
  type: "cpu" | "mem",
): ProcessStat[] {
  const map = new Map<string, { count: number; values: number[] }>();

  const alertLevels = new Set(["alert", "warn"]);
  for (const entry of entries) {
    if (entry.type !== type || !alertLevels.has(entry.level)) continue;
    const procs = (entry.data?.processes ?? []) as Array<{
      command: string;
      cpu: number;
      mem: number;
    }>;
    for (const p of procs) {
      const val = type === "cpu" ? p.cpu : p.mem;
      const existing = map.get(p.command) ?? { count: 0, values: [] };
      existing.count++;
      existing.values.push(val);
      map.set(p.command, existing);
    }
  }

  return Array.from(map.entries())
    .map(([command, { count, values }]) => ({
      command,
      alertCount: count,
      maxValue: Math.max(...values),
      avgValue:
        Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
        10,
      values,
    }))
    .sort((a, b) => b.alertCount - a.alertCount);
}

function buildMarkdownReport(
  from: Date,
  to: Date,
  entries: LogEntry[],
): string {
  const allAlerts = entries.filter(
    (e) => e.level === "alert" || e.level === "warn",
  );
  const cpuAlerts = allAlerts.filter((e) => e.type === "cpu");
  const memAlerts = allAlerts.filter((e) => e.type === "mem");
  const memWarn = memAlerts.filter((e) => e.level === "warn");
  const memCritical = memAlerts.filter((e) => e.level === "alert");
  const snapshots = entries.filter((e) => e.type === "snapshot");

  const cpuValues = snapshots
    .map((e) => (e.data?.totalCpu as number) ?? 0)
    .filter(Boolean);

  const swapValues = snapshots
    .map((e) => {
      const mem = e.data?.memory as
        | { swapUsedMB?: number }
        | undefined;
      return mem?.swapUsedMB ?? 0;
    });

  const pressureLevels = snapshots
    .map((e) => {
      const mem = e.data?.memory as
        | { pressureLevel?: number }
        | undefined;
      return mem?.pressureLevel ?? 100;
    });

  const avg = (arr: number[]) =>
    arr.length
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
      : 0;
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);
  const min = (arr: number[]) => (arr.length ? Math.min(...arr) : 0);

  const cpuProcs = aggregateProcesses(entries, "cpu");
  const memProcs = aggregateProcesses(entries, "mem");

  const fromStr = from.toISOString().slice(0, 16).replace("T", " ");
  const toStr = to.toISOString().slice(0, 16).replace("T", " ");

  let md = `# Watchdog Report\n\n`;
  md += `**Period:** ${fromStr} → ${toStr}\n\n`;
  md += `---\n\n`;

  md += `## Overview\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total snapshots | ${snapshots.length} |\n`;
  md += `| CPU alerts | ${cpuAlerts.length} |\n`;
  md += `| Memory pressure warnings (yellow) | ${memWarn.length} |\n`;
  md += `| Memory pressure critical (red) | ${memCritical.length} |\n`;
  md += `| Avg CPU load | ${avg(cpuValues)}% |\n`;
  md += `| Peak CPU load | ${max(cpuValues)}% |\n`;
  md += `| Lowest memory pressure level | ${min(pressureLevels)} |\n`;
  md += `| Peak swap usage | ${max(swapValues)}MB |\n`;
  md += `\n`;

  if (cpuProcs.length > 0) {
    md += `## Top CPU Offenders\n\n`;
    md += `| Process | Alerts | Avg CPU% | Peak CPU% |\n`;
    md += `|---------|--------|----------|-----------|\n`;
    for (const p of cpuProcs.slice(0, 15)) {
      md += `| ${p.command} | ${p.alertCount} | ${p.avgValue}% | ${p.maxValue}% |\n`;
    }
    md += `\n`;
  }

  if (memProcs.length > 0) {
    md += `## Top Memory Consumers (during pressure)\n\n`;
    md += `| Process | Seen in alerts | Avg Mem% | Peak Mem% |\n`;
    md += `|---------|----------------|----------|-----------|\n`;
    for (const p of memProcs.slice(0, 15)) {
      md += `| ${p.command} | ${p.alertCount} | ${p.avgValue}% | ${p.maxValue}% |\n`;
    }
    md += `\n`;
  }

  if (allAlerts.length > 0) {
    md += `## Alert Timeline\n\n`;
    const shown = allAlerts.slice(0, 100);
    for (const a of shown) {
      const ts = a.timestamp.slice(0, 19).replace("T", " ");
      let icon: string;
      if (a.type === "cpu") icon = "🔥";
      else if (a.level === "alert") icon = "🔴";
      else icon = "🟡";
      md += `- **${ts}** ${icon} [${a.type.toUpperCase()}] ${a.message.split("\n")[0]}\n`;
    }
    if (allAlerts.length > 100) {
      md += `\n_(${allAlerts.length - 100} more alerts omitted)_\n`;
    }
    md += `\n`;
  }

  if (allAlerts.length === 0) {
    md += `## No Alerts\n\nNo CPU or memory pressure issues during this period. Your Mac was running smoothly!\n`;
  }

  return md;
}

export function generateReport(
  logDir: string,
  reportDir: string,
  from: Date,
  to: Date,
): string {
  const entries = readLogs(logDir, from, to);
  const markdown = buildMarkdownReport(from, to, entries);

  ensureDir(reportDir);
  const fileName = `report-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.md`;
  const filePath = path.join(reportDir, fileName);
  fs.writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
