#!/usr/bin/env node

import { appendFileSync } from "fs";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const apiBaseUrl = (process.env.OTW_API_BASE_URL || "http://127.0.0.1:27187").replace(/\/$/, "");
const apiKey = process.env.OTW_API_KEY || "";
const logPath = process.env.OTW_MCP_LOG_PATH || "/tmp/obsidian-to-wordpress-mcp.log";
let buffer = Buffer.alloc(0);
let outputFraming: "headers" | "lines" = "headers";
let mcpDebug = process.env.OTW_MCP_DEBUG === "1";

void refreshDebugConfig();

logDebug("process_started", {
  pid: process.pid,
  node: process.version,
  cwd: process.cwd(),
  argv: process.argv,
  apiBaseUrl,
  hasApiKey: Boolean(apiKey),
});

process.stdin.on("data", (chunk) => {
  logDebug("stdin_data", { bytes: chunk.length, bufferedBytesBefore: buffer.length });
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages().catch((error) => {
    logDebug("drain_failed", { error: serializeError(error) });
    writeError(undefined, -32603, error instanceof Error ? error.message : "MCP server error");
  });
});

process.stdin.on("end", () => {
  logDebug("stdin_end", { bufferedBytes: buffer.length });
});

process.on("uncaughtException", (error) => {
  logDebug("uncaught_exception", { error: serializeError(error) });
});

process.on("unhandledRejection", (reason) => {
  logDebug("unhandled_rejection", { reason: serializeError(reason) });
});

async function drainMessages(): Promise<void> {
  while (true) {
    const delimiter = findHeaderDelimiter(buffer);
    if (!delimiter) {
      const drainedLineMessages = await drainLineDelimitedMessages();
      if (drainedLineMessages) continue;
      logDebug("delimiter_missing", { bufferedBytes: buffer.length, preview: previewBuffer(buffer) });
      return;
    }

    outputFraming = "headers";
    const header = buffer.slice(0, delimiter.index).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      logDebug("content_length_missing", { header });
      buffer = buffer.slice(delimiter.index + delimiter.length);
      continue;
    }

    const length = Number(match[1]);
    const messageStart = delimiter.index + delimiter.length;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) {
      logDebug("body_incomplete", { expectedBodyBytes: length, availableBytes: buffer.length - messageStart });
      return;
    }

    const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    logDebug("message_received", { header, bodyBytes: length, rawPreview: raw.slice(0, 500) });
    await handleMessage(JSON.parse(raw) as JsonRpcRequest);
  }
}

async function drainLineDelimitedMessages(): Promise<boolean> {
  const newlineIndex = buffer.indexOf(0x0a);
  if (newlineIndex < 0) return false;

  let drained = false;
  while (true) {
    const lineEnd = buffer.indexOf(0x0a);
    if (lineEnd < 0) break;

    const rawLine = buffer.slice(0, lineEnd).toString("utf8").trim();
    buffer = buffer.slice(lineEnd + 1);
    if (!rawLine) {
      drained = true;
      continue;
    }

    if (!rawLine.startsWith("{")) {
      logDebug("line_message_ignored", { rawPreview: rawLine.slice(0, 500) });
      drained = true;
      continue;
    }

    outputFraming = "lines";
    logDebug("line_message_received", { bodyBytes: Buffer.byteLength(rawLine, "utf8"), rawPreview: rawLine.slice(0, 500) });
    await handleMessage(JSON.parse(rawLine) as JsonRpcRequest);
    drained = true;
  }

  return drained;
}

function findHeaderDelimiter(value: Buffer): { index: number; length: number } | undefined {
  const headerText = value.toString("latin1");
  const match = /\r?\n\r?\n/.exec(headerText);
  if (!match || match.index === undefined) return undefined;
  return { index: match.index, length: match[0].length };
}

async function handleMessage(request: JsonRpcRequest): Promise<void> {
  logDebug("handle_message", { id: request.id, method: request.method });
  if (request.method === "notifications/initialized") return;

  try {
    if (request.method === "initialize") {
      const params = (request.params ?? {}) as { protocolVersion?: string };
      writeResult(request.id, {
        protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "obsidian-to-wordpress", version: "1.1.1-beta" },
      });
      return;
    }

    if (request.method === "tools/list") {
      writeResult(request.id, {
        tools: [
          {
            name: "obsidian_wordpress_health",
            description: "Check whether the Obsidian to WordPress local API is reachable.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
          {
            name: "list_published_obsidian_posts",
            description: "List all Markdown notes in the current Obsidian vault that have wp_post_id, including their remote WordPress status when reachable.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
          {
            name: "publish_current_obsidian_note",
            description: "Ask the open Obsidian plugin to publish the currently active note to WordPress.",
            inputSchema: publishSchema(false),
          },
          {
            name: "publish_obsidian_note",
            description: "Ask the open Obsidian plugin to publish a vault-relative note path to WordPress.",
            inputSchema: publishSchema(true),
          },
          {
            name: "get_obsidian_wordpress_post_status",
            description: "Fetch the remote WordPress post status for a vault-relative note path, or the active note if path is omitted.",
            inputSchema: pathSchema(false),
          },
          {
            name: "change_obsidian_wordpress_post_status",
            description: "Change the note frontmatter wp_status for a vault-relative note path, or the active note if path is omitted.",
            inputSchema: changeStatusSchema(),
          },
          {
            name: "unpublish_obsidian_wordpress_post",
            description: "Move the remote WordPress post for a vault-relative note path back to draft. Requires destructive API actions enabled in Obsidian settings.",
            inputSchema: pathSchema(false),
          },
          {
            name: "delete_obsidian_wordpress_post",
            description: "Trash or permanently delete the remote WordPress post for a vault-relative note path. Requires destructive API actions enabled in Obsidian settings.",
            inputSchema: deletePostSchema(),
          },
        ],
      });
      return;
    }

    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const result = await callTool(name, args);
      writeResult(request.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      return;
    }

    writeError(request.id, -32601, `Unsupported MCP method: ${request.method}`);
  } catch (error) {
    writeError(request.id, -32603, error instanceof Error ? error.message : "Tool call failed");
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  await refreshDebugConfig();
  logDebug("tool_call", { name, args: redactToolArgs(args) });
  if (name === "obsidian_wordpress_health") {
    return requestApi("GET", "/health");
  }

  if (name === "list_published_obsidian_posts") {
    return requestApi("GET", "/published-posts");
  }

  if (name === "publish_current_obsidian_note") {
    return requestApi("POST", "/publish-current", publishBody(args, false));
  }

  if (name === "publish_obsidian_note") {
    if (typeof args.path !== "string" || !args.path.trim()) {
      throw new Error("publish_obsidian_note requires a vault-relative path.");
    }
    return requestApi("POST", "/publish-note", publishBody(args, true));
  }

  if (name === "get_obsidian_wordpress_post_status") {
    return requestApi("POST", "/post-status", optionalPathBody(args));
  }

  if (name === "change_obsidian_wordpress_post_status") {
    return requestApi("POST", "/change-status", { ...optionalPathBody(args), status: normalizeRequiredStatus(args.status) });
  }

  if (name === "unpublish_obsidian_wordpress_post") {
    return requestApi("POST", "/unpublish", optionalPathBody(args));
  }

  if (name === "delete_obsidian_wordpress_post") {
    return requestApi("POST", "/delete-post", { ...optionalPathBody(args), force: Boolean(args.force) });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function publishBody(args: Record<string, unknown>, includePath: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    status: normalizeStatus(args.status),
    overwriteRemoteChanges: Boolean(args.overwriteRemoteChanges),
    allowInteractive: Boolean(args.allowInteractive),
  };
  if (includePath) {
    body.path = args.path;
    body.openBeforePublish = Boolean(args.openBeforePublish);
  }
  return body;
}

function optionalPathBody(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.path === "string" && args.path.trim() ? { path: args.path } : {};
}

function normalizeStatus(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeRequiredStatus(value);
}

function normalizeRequiredStatus(value: unknown): string {
  if (["draft", "publish", "private", "pending"].includes(String(value))) return String(value);
  throw new Error("status must be one of draft, publish, private, pending.");
}

async function requestApi(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
  logDebug("api_request", { method, path, hasBody: Boolean(body) });
  const headers: Record<string, string> = { accept: "application/json" };
  if (path !== "/health") {
    if (!apiKey) throw new Error("OTW_API_KEY is required for this MCP tool.");
    headers.authorization = `Bearer ${apiKey}`;
  }
  if (body) headers["content-type"] = "application/json";

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  logDebug("api_response", { method, path, status: response.status, bytes: text.length });
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_error) {
    parsed = text;
  }

  if (!response.ok) {
    return { ok: false, status: response.status, response: parsed };
  }
  return parsed;
}

async function refreshDebugConfig(): Promise<void> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const parsed = await response.json() as { data?: { debug?: boolean } };
    const nextDebug = Boolean(parsed.data?.debug);
    const wasDebug = mcpDebug;
    mcpDebug = nextDebug || process.env.OTW_MCP_DEBUG === "1";
    if (!wasDebug && mcpDebug) {
      logDebug("debug_enabled_from_plugin", {
        pid: process.pid,
        node: process.version,
        cwd: process.cwd(),
        apiBaseUrl,
        hasApiKey: Boolean(apiKey),
      });
    }
  } catch (error) {
    logDebug("debug_config_unavailable", { error: serializeError(error) });
  }
}

function publishSchema(withPath: boolean): JsonValue {
  const properties: Record<string, JsonValue> = {
    status: { type: "string", enum: ["draft", "publish", "private", "pending"], description: "Override the note wp_status for this publish." },
    overwriteRemoteChanges: { type: "boolean", description: "Overwrite when the remote WordPress modified timestamp changed." },
    allowInteractive: { type: "boolean", description: "Allow Obsidian to open modals if the plugin setting permits it." },
  };
  const required: string[] = [];
  if (withPath) {
    properties.path = { type: "string", description: "Vault-relative Markdown note path, for example folder/note.md." };
    properties.openBeforePublish = { type: "boolean", description: "Open the note in Obsidian before publishing." };
    required.push("path");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function pathSchema(requiredPath: boolean): JsonValue {
  return {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional vault-relative Markdown note path. If omitted, the active note is used." },
    },
    required: requiredPath ? ["path"] : [],
    additionalProperties: false,
  };
}

function changeStatusSchema(): JsonValue {
  return {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional vault-relative Markdown note path. If omitted, the active note is used." },
      status: { type: "string", enum: ["draft", "publish", "private", "pending"], description: "The wp_status value to write to note frontmatter." },
    },
    required: ["status"],
    additionalProperties: false,
  };
}

function deletePostSchema(): JsonValue {
  return {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional vault-relative Markdown note path. If omitted, the active note is used." },
      force: { type: "boolean", description: "false moves to trash; true deletes permanently." },
    },
    required: [],
    additionalProperties: false,
  };
}

function writeResult(id: JsonRpcRequest["id"], result: JsonValue): void {
  logDebug("write_result", { id });
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id: JsonRpcRequest["id"], code: number, message: string): void {
  logDebug("write_error", { id, code, message });
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(message: unknown): void {
  const json = JSON.stringify(message);
  logDebug("stdout_message", { bytes: Buffer.byteLength(json, "utf8"), framing: outputFraming, preview: json.slice(0, 500) });
  if (outputFraming === "lines") {
    process.stdout.write(`${json}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function logDebug(event: string, details?: unknown): void {
  if (!mcpDebug) return;
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${event}${details === undefined ? "" : ` ${safeJson(details)}`}\n`);
  } catch (_error) {
    // Never write MCP diagnostics to stdout/stderr because stdio is the protocol transport.
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return JSON.stringify(String(value));
  }
}

function previewBuffer(value: Buffer): string {
  return value.slice(0, 500).toString("utf8").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    output[key] = /key|token|password|secret|authorization/i.test(key) ? "[REDACTED]" : value;
  }
  return output;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}
