import { App, Modal, Notice, Setting } from "obsidian";
import type { Logger } from "./types";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  details?: unknown;
  time: string;
}

interface LoggerOptions {
  debug?: boolean;
  logPath?: string;
}

export class PublishLogger implements Logger {
  private entries: LogEntry[] = [];
  private debug = false;
  private logPath = "";

  constructor(options: LoggerOptions = {}) {
    this.configure(options);
  }

  configure(options: LoggerOptions): void {
    this.debug = Boolean(options.debug);
    this.logPath = options.logPath ?? this.logPath;
  }

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
    if (this.entries.length === 0) return "No log entries were recorded for this operation.";
    return this.entries.map((entry) => {
      const details = entry.details === undefined ? "" : `\n${safeStringify(entry.details)}`;
      return `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${details}`;
    }).join("\n\n");
  }

  clear(): void {
    this.entries = [];
  }

  private push(level: LogEntry["level"], message: string, details?: unknown): void {
    const entry = { level, message, details, time: new Date().toISOString() };
    this.entries.push(entry);
    if (this.debug) this.appendToFile(entry);
  }

  private appendToFile(entry: LogEntry): void {
    if (!this.logPath) return;
    try {
      const fs = loadFs();
      if (!fs) return;
      const path = loadPath();
      if (!path) return;
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      const details = entry.details === undefined ? "" : ` ${safeStringify(entry.details)}`;
      fs.appendFileSync(this.logPath, `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${details}\n`, "utf8");
    } catch (_error) {
      // Logging must never break publishing.
    }
  }
}

export function showErrorLogModal(app: App, title: string, logger: Logger, error?: unknown): void {
  new ErrorLogModal(app, title, buildErrorReport(title, logger, error)).open();
}

function buildErrorReport(title: string, logger: Logger, error?: unknown): string {
  const explicitError = error === undefined ? "" : `\n\nThrown error:\n${safeStringify(serializeError(error))}`;
  return `${title}\n\n${logger.dump()}${explicitError}`;
}

class ErrorLogModal extends Modal {
  constructor(app: App, private titleText: string, private report: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.titleText });
    contentEl.createEl("p", {
      text: "The operation failed. The error log below is for this run only.",
    });

    const pre = contentEl.createEl("pre");
    pre.style.maxHeight = "55vh";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";
    pre.setText(this.report);

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Copy error log")
        .onClick(async () => {
          await navigator.clipboard.writeText(this.report);
          new Notice("Error log copied", 4000);
        }))
      .addButton((button) => button
        .setCta()
        .setButtonText("Close")
        .onClick(() => this.close()));
  }
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
  const redacted = value
    .replace(/(Authorization:\s*)[^\n]+/gi, "$1[REDACTED]")
    .replace(/(Authorization\":\s*\")[^\"]+/gi, "$1[REDACTED]")
    .replace(/(OSSAccessKeyId=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Signature=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Expires=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(AccessKeyId>)[^<]+/gi, "$1[REDACTED]")
    .replace(/(SignatureProvided>)[^<]+/gi, "$1[REDACTED]");
  return redacted.length > 2000 ? `${redacted.slice(0, 2000)}\n...[truncated ${redacted.length - 2000} chars]` : redacted;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

declare const require: ((module: string) => unknown) | undefined;

function loadFs(): typeof import("fs") | undefined {
  if (typeof require !== "function") return undefined;
  return require("fs") as typeof import("fs");
}

function loadPath(): typeof import("path") | undefined {
  if (typeof require !== "function") return undefined;
  return require("path") as typeof import("path");
}
