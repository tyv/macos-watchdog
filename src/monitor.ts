import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import { takeSnapshot, type ProcessSnapshot, type MemoryPressure } from "./sampler.js";
import { writeLog, type LogEntry, type LogLevel } from "./logger.js";

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

const PRESSURE_RANK: Record<MemoryPressure, number> = {
  normal: 0,
  warn: 1,
  critical: 2,
};

const PRESSURE_LOG_LEVEL: Record<MemoryPressure, LogLevel> = {
  normal: "info",
  warn: "warn",
  critical: "alert",
};

const PRESSURE_LABEL: Record<MemoryPressure, string> = {
  normal: "GREEN",
  warn: "YELLOW",
  critical: "RED",
};

async function tick(config: Config): Promise<void> {
  const snapshot = await takeSnapshot(config.topN);
  const mem = snapshot.memory;

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

  const thresholdRank = PRESSURE_RANK[config.memPressureAlert];
  const currentRank = PRESSURE_RANK[mem.pressure];

  if (currentRank >= thresholdRank && mem.pressure !== "normal") {
    const label = PRESSURE_LABEL[mem.pressure];
    const entry: LogEntry = {
      timestamp: snapshot.timestamp,
      level: PRESSURE_LOG_LEVEL[mem.pressure],
      type: "mem",
      message: `Memory pressure ${label} (level ${mem.pressureLevel}, swap ${mem.swapUsedMB}MB/${mem.swapTotalMB}MB). Top consumers:\n${formatProcs(snapshot.topMem, "mem")}`,
      data: {
        pressure: mem.pressure,
        pressureLevel: mem.pressureLevel,
        swapUsedMB: mem.swapUsedMB,
        swapTotalMB: mem.swapTotalMB,
        freeMemMB: mem.freeMemMB,
        totalMemMB: mem.totalMemMB,
        processes: snapshot.topMem,
      },
    };
    writeLog(config.logDir, entry);
    console.log(`[${snapshot.timestamp}] MEM ${label} — pressure level ${mem.pressureLevel}, swap ${mem.swapUsedMB}MB used`);
  }

  const snapshotEntry: LogEntry = {
    timestamp: snapshot.timestamp,
    level: "info",
    type: "snapshot",
    message: `CPU ~${snapshot.totalCpu}% | Mem pressure: ${mem.pressure} (level ${mem.pressureLevel}) | Swap: ${mem.swapUsedMB}MB/${mem.swapTotalMB}MB`,
    data: {
      totalCpu: snapshot.totalCpu,
      memory: mem,
      topCpu: snapshot.topCpu,
      topMem: snapshot.topMem,
    },
  };
  writeLog(config.logDir, snapshotEntry);
}

export function startMonitor(config: Config): void {
  ensureDir(path.dirname(config.pidFile));

  fs.writeFileSync(config.pidFile, String(process.pid), "utf-8");

  console.log(`Watchdog started (PID ${process.pid})`);
  console.log(`  Interval: ${config.intervalSec}s`);
  console.log(`  CPU threshold: ${config.cpuThreshold}%`);
  console.log(`  Mem pressure alert: ${config.memPressureAlert} (${config.memPressureAlert === "warn" ? "yellow + red" : "red only"})`);
  console.log(`  Logs: ${config.logDir}`);
  console.log(`  PID file: ${config.pidFile}`);
  console.log("");

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
