import fs from "node:fs";
import path from "node:path";

export type LogLevel = "info" | "warn" | "alert";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  type: "cpu" | "mem" | "snapshot";
  message: string;
  data?: Record<string, unknown>;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Returns the log file path for a given date (one file per day).
 */
function logFilePath(logDir: string, date: Date): string {
  const day = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(logDir, `watchdog-${day}.jsonl`);
}

export function writeLog(logDir: string, entry: LogEntry): void {
  ensureDir(logDir);
  const file = logFilePath(logDir, new Date(entry.timestamp));
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(file, line, "utf-8");
}

/**
 * Reads all log entries in the given date range (inclusive).
 * Iterates day-by-day using UTC to stay consistent with log file naming.
 */
export function readLogs(
  logDir: string,
  from: Date,
  to: Date,
): LogEntry[] {
  ensureDir(logDir);
  const entries: LogEntry[] = [];

  const startDay = from.toISOString().slice(0, 10);
  const endDay = to.toISOString().slice(0, 10);

  let currentDay = startDay;
  while (currentDay <= endDay) {
    const file = path.join(logDir, `watchdog-${currentDay}.jsonl`);
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          const ts = new Date(entry.timestamp);
          if (ts >= from && ts <= to) {
            entries.push(entry);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    // advance by one day in UTC
    const d = new Date(currentDay + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    currentDay = d.toISOString().slice(0, 10);
  }

  return entries;
}
