import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { takeSnapshot, type ProcessSnapshot } from "./sampler.js";
import { writeLog, type LogEntry } from "./logger.js";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatProcs(procs: ProcessSnapshot[], metric: "cpu" | "mem"): string {
  return procs
    .map(
      (p) =>
        `  PID ${p.pid}  ${metric === "cpu" ? p.cpu : p.mem}%  ${p.command}`,
    )
    .join("\n");
}

async function tick(config: Config): Promise<void> {
  const snapshot = await takeSnapshot(config.topN);

  const heavyCpuProcs = snapshot.topCpu.filter(
    (p) => p.cpu >= config.cpuThreshold,
  );

  if (heavyCpuProcs.length > 0) {
    const entry: LogEntry = {
      timestamp: snapshot.timestamp,
      level: "alert",
      type: "cpu",
      message: `High CPU detected (system ~${snapshot.totalCpu}%). Top offenders:\n${formatProcs(heavyCpuProcs, "cpu")}`,
      data: {
        totalCpu: snapshot.totalCpu,
        processes: heavyCpuProcs,
      },
    };
    writeLog(config.logDir, entry);
    console.log(`[${snapshot.timestamp}] CPU ALERT — ${heavyCpuProcs.length} process(es) above ${config.cpuThreshold}%`);
  }

  if (snapshot.usedMemPct >= config.memThreshold) {
    const entry: LogEntry = {
      timestamp: snapshot.timestamp,
      level: "alert",
      type: "mem",
      message: `High system memory (${snapshot.usedMemPct}% used, ${snapshot.freeMemMB}MB free). Top consumers:\n${formatProcs(snapshot.topMem, "mem")}`,
      data: {
        usedMemPct: snapshot.usedMemPct,
        freeMemMB: snapshot.freeMemMB,
        totalMemMB: snapshot.totalMemMB,
        processes: snapshot.topMem,
      },
    };
    writeLog(config.logDir, entry);
    console.log(`[${snapshot.timestamp}] MEM ALERT — system at ${snapshot.usedMemPct}% (${snapshot.freeMemMB}MB free)`);
  }

  // Always write a periodic snapshot at info level for the report
  const snapshotEntry: LogEntry = {
    timestamp: snapshot.timestamp,
    level: "info",
    type: "snapshot",
    message: `CPU ~${snapshot.totalCpu}% | Mem ~${snapshot.usedMemPct}% (${snapshot.freeMemMB}MB free)`,
    data: {
      totalCpu: snapshot.totalCpu,
      usedMemPct: snapshot.usedMemPct,
      freeMemMB: snapshot.freeMemMB,
      totalMemMB: snapshot.totalMemMB,
      topCpu: snapshot.topCpu,
      topMem: snapshot.topMem,
    },
  };
  writeLog(config.logDir, snapshotEntry);
}

export function startMonitor(config: Config): void {
  ensureDir(path.dirname(config.pidFile));

  // Write PID file so we can stop the daemon later
  fs.writeFileSync(config.pidFile, String(process.pid), "utf-8");

  console.log(`Watchdog started (PID ${process.pid})`);
  console.log(`  Interval: ${config.intervalSec}s`);
  console.log(`  CPU threshold: ${config.cpuThreshold}%`);
  console.log(`  Mem threshold: ${config.memThreshold}% (system-wide)`);
  console.log(`  Logs: ${config.logDir}`);
  console.log(`  PID file: ${config.pidFile}`);
  console.log("");

  // Run immediately, then repeat
  tick(config).catch(console.error);
  const timer = setInterval(() => {
    tick(config).catch(console.error);
  }, config.intervalSec * 1000);

  const cleanup = () => {
    clearInterval(timer);
    try {
      fs.unlinkSync(config.pidFile);
    } catch {}
    console.log("\nWatchdog stopped.");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
