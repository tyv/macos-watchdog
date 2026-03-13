import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface ProcessSnapshot {
  pid: number;
  cpu: number;
  mem: number;
  command: string;
}

export type MemoryPressure = "normal" | "warn" | "critical";

export interface MemoryInfo {
  pressure: MemoryPressure;
  pressureLevel: number;
  swapUsedMB: number;
  swapTotalMB: number;
  freeMemMB: number;
  totalMemMB: number;
}

export interface SystemSnapshot {
  timestamp: string;
  totalCpu: number;
  memory: MemoryInfo;
  topCpu: ProcessSnapshot[];
  topMem: ProcessSnapshot[];
}

async function getProcessList(): Promise<ProcessSnapshot[]> {
  const { stdout } = await execFileAsync("ps", [
    "-arcwwwxo",
    "pid,pcpu,pmem,comm",
  ]);

  const lines = stdout.trim().split("\n").slice(1);
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0], 10);
    const cpu = parseFloat(parts[1]);
    const mem = parseFloat(parts[2]);
    const command = parts.slice(3).join(" ");
    return { pid, cpu, mem, command };
  });
}

function getOverallCpuPct(): number {
  const [load1] = os.loadavg();
  const cores = os.cpus().length;
  return Math.round((load1 / cores) * 100 * 10) / 10;
}

function classifyPressure(level: number): MemoryPressure {
  if (level < 10) return "critical";
  if (level < 25) return "warn";
  return "normal";
}

/**
 * Reads macOS memory pressure via `kern.memorystatus_level` and
 * swap usage via `vm.swapusage`. Falls back to os.freemem() if
 * sysctl calls fail (non-macOS).
 */
async function getMemoryInfo(): Promise<MemoryInfo> {
  const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemMB = Math.round(os.freemem() / 1024 / 1024);

  let pressureLevel = 100;
  let swapUsedMB = 0;
  let swapTotalMB = 0;

  try {
    const { stdout } = await execFileAsync("sysctl", [
      "-n",
      "kern.memorystatus_level",
    ]);
    pressureLevel = parseInt(stdout.trim(), 10);
  } catch {}

  try {
    const { stdout } = await execFileAsync("sysctl", ["-n", "vm.swapusage"]);
    // Output: "total = 13312.00M  used = 11750.38M  free = 1561.62M  (encrypted)"
    const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/);
    const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/);
    if (totalMatch) swapTotalMB = Math.round(parseFloat(totalMatch[1]));
    if (usedMatch) swapUsedMB = Math.round(parseFloat(usedMatch[1]));
  } catch {}

  return {
    pressure: classifyPressure(pressureLevel),
    pressureLevel,
    swapUsedMB,
    swapTotalMB,
    freeMemMB,
    totalMemMB,
  };
}

export async function takeSnapshot(topN: number): Promise<SystemSnapshot> {
  const [procs, memory] = await Promise.all([
    getProcessList(),
    getMemoryInfo(),
  ]);

  const topCpu = procs.slice(0, topN);
  const topMem = [...procs]
    .sort((a, b) => b.mem - a.mem)
    .slice(0, topN);

  return {
    timestamp: new Date().toISOString(),
    totalCpu: getOverallCpuPct(),
    memory,
    topCpu,
    topMem,
  };
}
