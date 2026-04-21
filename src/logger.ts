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
    return JSON.stringify(redactSecrets(value), null, 2);
  } catch (_error) {
    return redactSecretText(String(value));
  }
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactSecretText(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);

  const output: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    output[key] = isSecretKey(key) ? "[REDACTED]" : redactSecrets(item);
  });
  return output;
}

function isSecretKey(key: string): boolean {
  return /authorization|password|secret|token|signature|accesskeyid|ossaccesskeyid/i.test(key);
}

function redactSecretText(value: string): string {
  return value
    .replace(/(Authorization:\s*)[^\n]+/gi, "$1[REDACTED]")
    .replace(/(OSSAccessKeyId=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Signature=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(AccessKeyId>)[^<]+/gi, "$1[REDACTED]")
    .replace(/(SignatureProvided>)[^<]+/gi, "$1[REDACTED]");
}
