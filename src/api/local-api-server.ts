import type { Server, IncomingMessage, ServerResponse } from "http";
import type WordPressPublisherPlugin from "../main";
import type { Logger, PublishOptions, PublishResult } from "../types";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  errorCode?: string;
  message?: string;
  logs?: string;
}

interface PublishCurrentBody {
  status?: PublishOptions["status"];
  overwriteRemoteChanges?: boolean;
  allowInteractive?: boolean;
}

interface PublishNoteBody extends PublishCurrentBody {
  path?: string;
  openBeforePublish?: boolean;
}

interface PathBody {
  path?: string;
}

interface DeletePostBody extends PathBody {
  force?: boolean;
}

interface ChangeStatusBody extends PathBody {
  status?: PublishOptions["status"];
}

export class LocalApiServer {
  private server?: Server;
  private runningPort?: number;

  constructor(private plugin: WordPressPublisherPlugin, private logger: Logger) {}

  async start(): Promise<void> {
    if (!this.plugin.settings.localApi.enabled) return;
    if (this.server) return;

    const http = loadHttp();
    const port = this.plugin.settings.localApi.port;
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.logger.error("Local API request failed", serializeError(error));
        sendJson(response, 500, {
          ok: false,
          errorCode: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Local API internal error",
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "127.0.0.1", () => {
        this.server?.off("error", reject);
        this.runningPort = port;
        this.logger.info("Local API server started", { host: "127.0.0.1", port });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.runningPort = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
    this.logger.info("Local API server stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }

  getPort(): number | undefined {
    return this.runningPort;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.plugin.settings.localApi.port}`);
    this.logger.info("Local API request", { method: request.method, path: url.pathname });

    if (url.pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        data: {
          plugin: "obsidian-to-wordpress",
          version: this.plugin.manifest.version,
          vault: this.plugin.app.vault.getName(),
          apiEnabled: this.plugin.settings.localApi.enabled,
          apiRunning: this.isRunning(),
        },
      });
      return;
    }

    if (!(await this.authorize(request))) {
      sendJson(response, 401, { ok: false, errorCode: "UNAUTHORIZED", message: "Missing or invalid API key." });
      return;
    }

    if (url.pathname === "/published-posts" && request.method === "GET") {
      const posts = await this.plugin.listPublishedPostsFromApi();
      sendJson(response, 200, { ok: true, data: posts });
      return;
    }

    if (url.pathname === "/publish-current" && request.method === "POST") {
      const body = await readJson<PublishCurrentBody>(request);
      const result = await this.plugin.publishCurrentNoteFromApi({
        status: body.status,
        overwriteRemoteChanges: Boolean(body.overwriteRemoteChanges),
        allowInteractive: this.resolveInteractive(body.allowInteractive),
        showNotice: false,
        source: "api",
      });
      this.sendPublishResult(response, result);
      return;
    }

    if (url.pathname === "/publish-note" && request.method === "POST") {
      const body = await readJson<PublishNoteBody>(request);
      if (!body.path) {
        sendJson(response, 400, { ok: false, errorCode: "MISSING_PATH", message: "Request body must include path." });
        return;
      }
      const result = await this.plugin.publishNoteFromApi(body.path, {
        status: body.status,
        overwriteRemoteChanges: Boolean(body.overwriteRemoteChanges),
        allowInteractive: this.resolveInteractive(body.allowInteractive),
        openBeforePublish: Boolean(body.openBeforePublish),
        showNotice: false,
        source: "api",
      });
      this.sendPublishResult(response, result);
      return;
    }

    if (url.pathname === "/post-status" && request.method === "POST") {
      const body = await readJson<PathBody>(request);
      const remote = await this.plugin.getRemoteStatusFromApi(body.path);
      sendJson(response, 200, { ok: true, data: remote, logs: this.logger.dump() });
      return;
    }

    if (url.pathname === "/unpublish" && request.method === "POST") {
      if (!this.plugin.settings.localApi.allowDestructiveActions) {
        sendJson(response, 403, {
          ok: false,
          errorCode: "DESTRUCTIVE_ACTIONS_DISABLED",
          message: "Enable destructive local API actions in plugin settings before unpublishing remote posts.",
        });
        return;
      }
      const body = await readJson<PathBody>(request);
      const remote = await this.plugin.unpublishFromApi(body.path);
      sendJson(response, 200, { ok: true, data: remote, logs: this.logger.dump() });
      return;
    }

    if (url.pathname === "/delete-post" && request.method === "POST") {
      if (!this.plugin.settings.localApi.allowDestructiveActions) {
        sendJson(response, 403, {
          ok: false,
          errorCode: "DESTRUCTIVE_ACTIONS_DISABLED",
          message: "Enable destructive local API actions in plugin settings before deleting remote posts.",
        });
        return;
      }
      const body = await readJson<DeletePostBody>(request);
      const result = await this.plugin.deleteRemotePostFromApi(body.path, Boolean(body.force));
      sendJson(response, 200, { ok: true, data: result, logs: this.logger.dump() });
      return;
    }

    if (url.pathname === "/change-status" && request.method === "POST") {
      const body = await readJson<ChangeStatusBody>(request);
      if (!body.status) {
        sendJson(response, 400, { ok: false, errorCode: "MISSING_STATUS", message: "Request body must include status." });
        return;
      }
      const result = await this.plugin.changePostStatusFromApi(body.path, body.status);
      sendJson(response, 200, { ok: true, data: result, logs: this.logger.dump() });
      return;
    }

    sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", message: "Local API endpoint not found." });
  }

  private async authorize(request: IncomingMessage): Promise<boolean> {
    const header = String(request.headers.authorization ?? "");
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    return this.plugin.verifyLocalApiKey(provided);
  }

  private resolveInteractive(requested: boolean | undefined): boolean {
    return Boolean(requested && this.plugin.settings.localApi.allowInteractive);
  }

  private sendPublishResult(response: ServerResponse, result: PublishResult | undefined): void {
    if (!result) {
      sendJson(response, 202, {
        ok: true,
        data: { interactive: true, message: "Interactive Obsidian publish flow was opened." },
        logs: this.logger.dump(),
      });
      return;
    }
    sendJson(response, 200, { ok: true, data: result, logs: this.logger.dump() });
  }
}

declare const require: ((module: string) => unknown) | undefined;

function loadHttp(): typeof import("http") {
  if (typeof require !== "function") throw new Error("Node HTTP module is unavailable in this Obsidian environment.");
  return require("http") as typeof import("http");
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function sendJson(response: ServerResponse, status: number, body: ApiResponse): void {
  setCorsHeaders(response);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "http://127.0.0.1");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}
