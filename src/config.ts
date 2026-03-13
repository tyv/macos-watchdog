import path from "node:path";
import os from "node:os";

export interface Config {
  /** Sampling interval in seconds */
  intervalSec: number;
  /** CPU usage % threshold per-process to trigger a log entry */
  cpuThreshold: number;
  /** System-wide memory usage % threshold to trigger a log entry */
  memThreshold: number;
  /** Directory where JSONL log files are stored */
  logDir: string;
  /** Directory where generated reports are saved */
  reportDir: string;
  /** Path to the PID file for the background daemon */
  pidFile: string;
  /** Top N processes to include when threshold is exceeded */
  topN: number;
}

const BASE_DIR =
  process.env.WATCHDOG_HOME ??
  path.join(os.homedir(), ".macos-watchdog");

export const DEFAULT_CONFIG: Config = {
  intervalSec: 30,
  cpuThreshold: 80,
  memThreshold: 90,
  logDir: path.join(BASE_DIR, "logs"),
  reportDir: path.join(BASE_DIR, "reports"),
  pidFile: path.join(BASE_DIR, "watchdog.pid"),
  topN: 5,
};

export function resolveConfig(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}
