import type { Logger, MediaCacheEntry } from "./types";

export interface MediaCacheStore {
  get(vaultPath: string): Promise<MediaCacheEntry | undefined>;
  set(entry: MediaCacheEntry): Promise<void>;
  delete(vaultPath: string): Promise<void>;
  list(): Promise<MediaCacheEntry[]>;
  migrateFromSettingsCache(cache: Record<string, MediaCacheEntry>): Promise<number>;
}

type MediaCacheOperation =
  | { op: "upsert"; key: string; value: MediaCacheEntry; time: string }
  | { op: "delete"; key: string; time: string };

export class JsonlMediaCacheStore implements MediaCacheStore {
  private entries = new Map<string, MediaCacheEntry>();
  private loaded = false;

  constructor(private filePath: string, private logger: Logger) {}

  async get(vaultPath: string): Promise<MediaCacheEntry | undefined> {
    await this.ensureLoaded();
    return this.entries.get(vaultPath);
  }

  async set(entry: MediaCacheEntry): Promise<void> {
    await this.ensureLoaded();
    this.entries.set(entry.vaultPath, entry);
    await this.append({ op: "upsert", key: entry.vaultPath, value: entry, time: new Date().toISOString() });
  }

  async delete(vaultPath: string): Promise<void> {
    await this.ensureLoaded();
    this.entries.delete(vaultPath);
    await this.append({ op: "delete", key: vaultPath, time: new Date().toISOString() });
  }

  async list(): Promise<MediaCacheEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  async migrateFromSettingsCache(cache: Record<string, MediaCacheEntry>): Promise<number> {
    await this.ensureLoaded();
    const entries = Object.entries(cache ?? {});
    if (entries.length === 0) return 0;

    for (const [key, entry] of entries) {
      if (!entry?.vaultPath || !entry.url) continue;
      const normalized = { ...entry, vaultPath: entry.vaultPath || key };
      this.entries.set(normalized.vaultPath, normalized);
    }

    await this.compact();
    this.logger.info("Migrated media cache from plugin settings to JSONL store", { count: entries.length, filePath: this.filePath });
    return entries.length;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const fs = loadFs();
    if (!fs.existsSync(this.filePath)) return;

    const raw = fs.readFileSync(this.filePath, "utf8");
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        this.apply(JSON.parse(line) as MediaCacheOperation);
      } catch (error) {
        this.logger.warn("Skipped invalid media cache JSONL line", {
          filePath: this.filePath,
          line: index + 1,
          error: serializeError(error),
        });
      }
    }

    this.logger.info("Loaded media cache JSONL store", { filePath: this.filePath, count: this.entries.size });
  }

  private apply(operation: MediaCacheOperation): void {
    if (operation.op === "upsert") {
      this.entries.set(operation.key, operation.value);
      return;
    }
    if (operation.op === "delete") {
      this.entries.delete(operation.key);
    }
  }

  private async append(operation: MediaCacheOperation): Promise<void> {
    const fs = loadFs();
    const path = loadPath();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(operation)}\n`, "utf8");
  }

  private async compact(): Promise<void> {
    const fs = loadFs();
    const path = loadPath();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const lines = Array.from(this.entries.entries()).map(([key, value]) => JSON.stringify({
      op: "upsert",
      key,
      value,
      time: new Date().toISOString(),
    }));
    fs.writeFileSync(this.filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
  }
}

declare const require: ((module: string) => unknown) | undefined;

function loadFs(): typeof import("fs") {
  if (typeof require !== "function") throw new Error("Node fs module is unavailable in this Obsidian environment.");
  return require("fs") as typeof import("fs");
}

function loadPath(): typeof import("path") {
  if (typeof require !== "function") throw new Error("Node path module is unavailable in this Obsidian environment.");
  return require("path") as typeof import("path");
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}
