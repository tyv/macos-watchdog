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

  for (const entry of entries) {
    if (entry.type !== type || entry.level !== "alert") continue;
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
  const alerts = entries.filter((e) => e.level === "alert");
  const cpuAlerts = alerts.filter((e) => e.type === "cpu");
  const memAlerts = alerts.filter((e) => e.type === "mem");
  const snapshots = entries.filter((e) => e.type === "snapshot");

  const cpuValues = snapshots
    .map((e) => (e.data?.totalCpu as number) ?? 0)
    .filter(Boolean);
  const memValues = snapshots
    .map((e) => (e.data?.usedMemPct as number) ?? 0)
    .filter(Boolean);

  const avg = (arr: number[]) =>
    arr.length
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
      : 0;
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

  const cpuProcs = aggregateProcesses(entries, "cpu");
  const memProcs = aggregateProcesses(entries, "mem");

  const fromStr = from.toISOString().slice(0, 16).replace("T", " ");
  const toStr = to.toISOString().slice(0, 16).replace("T", " ");

  let md = `# Watchdog Report\n\n`;
  md += `**Period:** ${fromStr} → ${toStr}\n\n`;
  md += `---\n\n`;

  // Overview
  md += `## Overview\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total snapshots | ${snapshots.length} |\n`;
  md += `| Total alerts | ${alerts.length} |\n`;
  md += `| CPU alerts | ${cpuAlerts.length} |\n`;
  md += `| Memory alerts | ${memAlerts.length} |\n`;
  md += `| Avg CPU load | ${avg(cpuValues)}% |\n`;
  md += `| Peak CPU load | ${max(cpuValues)}% |\n`;
  md += `| Avg memory used | ${avg(memValues)}% |\n`;
  md += `| Peak memory used | ${max(memValues)}% |\n`;
  md += `\n`;

  // CPU offenders
  if (cpuProcs.length > 0) {
    md += `## Top CPU Offenders\n\n`;
    md += `| Process | Alerts | Avg CPU% | Peak CPU% |\n`;
    md += `|---------|--------|----------|-----------|\n`;
    for (const p of cpuProcs.slice(0, 15)) {
      md += `| ${p.command} | ${p.alertCount} | ${p.avgValue}% | ${p.maxValue}% |\n`;
    }
    md += `\n`;
  }

  // Memory offenders
  if (memProcs.length > 0) {
    md += `## Top Memory Offenders\n\n`;
    md += `| Process | Alerts | Avg Mem% | Peak Mem% |\n`;
    md += `|---------|--------|----------|-----------|\n`;
    for (const p of memProcs.slice(0, 15)) {
      md += `| ${p.command} | ${p.alertCount} | ${p.avgValue}% | ${p.maxValue}% |\n`;
    }
    md += `\n`;
  }

  // Timeline of alerts
  if (alerts.length > 0) {
    md += `## Alert Timeline\n\n`;
    const shown = alerts.slice(0, 100);
    for (const a of shown) {
      const ts = a.timestamp.slice(0, 19).replace("T", " ");
      const icon = a.type === "cpu" ? "🔥" : "💾";
      md += `- **${ts}** ${icon} [${a.type.toUpperCase()}] ${a.message.split("\n")[0]}\n`;
    }
    if (alerts.length > 100) {
      md += `\n_(${alerts.length - 100} more alerts omitted)_\n`;
    }
    md += `\n`;
  }

  if (alerts.length === 0) {
    md += `## No Alerts\n\nNo CPU or memory threshold breaches during this period. Your Mac was running smoothly!\n`;
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
