import { Notice } from "obsidian";
import type { Logger } from "./types";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  details?: unknown;
  time: string;
}

export class PublishLogger implements Logger {
  private entries: LogEntry[] = [];

  info(message: string, details?: unknown): void {
    this.push("info", message, details);
  }

  warn(message: string, details?: unknown): void {
    this.push("warn", message, details);
  }

  error(message: string, details?: unknown): void {
    this.push("error", message, details);
  }

  dump(): string {
    return this.entries.map((entry) => {
      const details = entry.details === undefined ? "" : `\n${safeStringify(entry.details)}`;
      return `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${details}`;
    }).join("\n\n");
  }

  clear(): void {
    this.entries = [];
  }

  private push(level: LogEntry["level"], message: string, details?: unknown): void {
    this.entries.push({ level, message, details, time: new Date().toISOString() });
  }
}

export function showLogNotice(title: string, logger: Logger): void {
  new Notice(`${title}\n\n${logger.dump()}`, 15000);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}
