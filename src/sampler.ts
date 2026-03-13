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

export interface SystemSnapshot {
  timestamp: string;
  totalCpu: number;
  usedMemPct: number;
  freeMemMB: number;
  totalMemMB: number;
  topCpu: ProcessSnapshot[];
  topMem: ProcessSnapshot[];
}

/**
 * Reads per-process CPU and memory usage via `ps`.
 * Sorted by CPU descending (the -r flag).
 */
async function getProcessList(): Promise<ProcessSnapshot[]> {
  const { stdout } = await execFileAsync("ps", [
    "-arcwwwxo",
    "pid,pcpu,pmem,comm",
  ]);

  const lines = stdout.trim().split("\n").slice(1); // skip header
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0], 10);
    const cpu = parseFloat(parts[1]);
    const mem = parseFloat(parts[2]);
    const command = parts.slice(3).join(" ");
    return { pid, cpu, mem, command };
  });
}

/**
 * Approximates overall CPU load using os.loadavg() 1-minute average
 * normalised to the number of logical cores.
 */
function getOverallCpuPct(): number {
  const [load1] = os.loadavg();
  const cores = os.cpus().length;
  return Math.round((load1 / cores) * 100 * 10) / 10;
}

function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct =
    Math.round(((totalMem - freeMem) / totalMem) * 100 * 10) / 10;
  return {
    totalMemMB: Math.round(totalMem / 1024 / 1024),
    freeMemMB: Math.round(freeMem / 1024 / 1024),
    usedMemPct: usedPct,
  };
}

export async function takeSnapshot(topN: number): Promise<SystemSnapshot> {
  const procs = await getProcessList();
  const memInfo = getMemoryInfo();

  const topCpu = procs.slice(0, topN); // already sorted by CPU desc
  const topMem = [...procs]
    .sort((a, b) => b.mem - a.mem)
    .slice(0, topN);

  return {
    timestamp: new Date().toISOString(),
    totalCpu: getOverallCpuPct(),
    ...memInfo,
    topCpu,
    topMem,
  };
}
