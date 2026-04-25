var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => WordPressPublisherPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian14 = require("obsidian");

// src/api/local-api-server.ts
var LocalApiServer = class {
  constructor(plugin, logger) {
    this.plugin = plugin;
    this.logger = logger;
  }
  async start() {
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
          message: error instanceof Error ? error.message : "Local API internal error"
        });
      });
    });
    await new Promise((resolve, reject) => {
      var _a, _b;
      (_a = this.server) == null ? void 0 : _a.once("error", reject);
      (_b = this.server) == null ? void 0 : _b.listen(port, "127.0.0.1", () => {
        var _a2;
        (_a2 = this.server) == null ? void 0 : _a2.off("error", reject);
        this.runningPort = port;
        this.logger.info("Local API server started", { host: "127.0.0.1", port });
        resolve();
      });
    });
  }
  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = void 0;
    this.runningPort = void 0;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    this.logger.info("Local API server stopped");
  }
  async restart() {
    await this.stop();
    await this.start();
  }
  isRunning() {
    var _a;
    return Boolean((_a = this.server) == null ? void 0 : _a.listening);
  }
  getPort() {
    return this.runningPort;
  }
  async handleRequest(request, response) {
    var _a;
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL((_a = request.url) != null ? _a : "/", `http://127.0.0.1:${this.plugin.settings.localApi.port}`);
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
          debug: this.plugin.getDebugConfig().debug
        }
      });
      return;
    }
    if (!await this.authorize(request)) {
      sendJson(response, 401, { ok: false, errorCode: "UNAUTHORIZED", message: "Missing or invalid API key." });
      return;
    }
    if (url.pathname === "/published-posts" && request.method === "GET") {
      const posts = await this.plugin.listPublishedPostsFromApi();
      sendJson(response, 200, { ok: true, data: posts });
      return;
    }
    if (url.pathname === "/publish-current" && request.method === "POST") {
      const body = await readJson(request);
      const result = await this.plugin.publishCurrentNoteFromApi({
        status: body.status,
        overwriteRemoteChanges: Boolean(body.overwriteRemoteChanges),
        allowInteractive: this.resolveInteractive(body.allowInteractive),
        showNotice: false,
        source: "api"
      });
      this.sendPublishResult(response, result);
      return;
    }
    if (url.pathname === "/publish-note" && request.method === "POST") {
      const body = await readJson(request);
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
        source: "api"
      });
      this.sendPublishResult(response, result);
      return;
    }
    if (url.pathname === "/post-status" && request.method === "POST") {
      const body = await readJson(request);
      const remote = await this.plugin.getRemoteStatusFromApi(body.path);
      sendJson(response, 200, { ok: true, data: remote });
      return;
    }
    if (url.pathname === "/unpublish" && request.method === "POST") {
      if (!this.plugin.settings.localApi.allowDestructiveActions) {
        sendJson(response, 403, {
          ok: false,
          errorCode: "DESTRUCTIVE_ACTIONS_DISABLED",
          message: "Enable destructive local API actions in plugin settings before unpublishing remote posts."
        });
        return;
      }
      const body = await readJson(request);
      const remote = await this.plugin.unpublishFromApi(body.path);
      sendJson(response, 200, { ok: true, data: remote });
      return;
    }
    if (url.pathname === "/delete-post" && request.method === "POST") {
      if (!this.plugin.settings.localApi.allowDestructiveActions) {
        sendJson(response, 403, {
          ok: false,
          errorCode: "DESTRUCTIVE_ACTIONS_DISABLED",
          message: "Enable destructive local API actions in plugin settings before deleting remote posts."
        });
        return;
      }
      const body = await readJson(request);
      const result = await this.plugin.deleteRemotePostFromApi(body.path, Boolean(body.force));
      sendJson(response, 200, { ok: true, data: result });
      return;
    }
    if (url.pathname === "/change-status" && request.method === "POST") {
      const body = await readJson(request);
      if (!body.status) {
        sendJson(response, 400, { ok: false, errorCode: "MISSING_STATUS", message: "Request body must include status." });
        return;
      }
      const result = await this.plugin.changePostStatusFromApi(body.path, body.status);
      sendJson(response, 200, { ok: true, data: result });
      return;
    }
    sendJson(response, 404, { ok: false, errorCode: "NOT_FOUND", message: "Local API endpoint not found." });
  }
  async authorize(request) {
    var _a;
    const header = String((_a = request.headers.authorization) != null ? _a : "");
    const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    return this.plugin.verifyLocalApiKey(provided);
  }
  resolveInteractive(requested) {
    return Boolean(requested && this.plugin.settings.localApi.allowInteractive);
  }
  sendPublishResult(response, result) {
    if (!result) {
      sendJson(response, 202, {
        ok: true,
        data: { interactive: true, message: "Interactive Obsidian publish flow was opened." }
      });
      return;
    }
    sendJson(response, 200, { ok: true, data: result });
  }
};
function loadHttp() {
  if (typeof require !== "function") throw new Error("Node HTTP module is unavailable in this Obsidian environment.");
  return require("http");
}
async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}
function sendJson(response, status, body) {
  setCorsHeaders(response);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "http://127.0.0.1");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
}
function serializeError(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

// src/frontmatter.ts
var FrontmatterService = class {
  constructor(app) {
    this.app = app;
  }
  read(file) {
    var _a;
    const cache = this.app.metadataCache.getFileCache(file);
    return { ...(_a = cache == null ? void 0 : cache.frontmatter) != null ? _a : {} };
  }
  hasRequiredMapping(metadata) {
    return Boolean(metadata.wp_title && metadata.wp_status);
  }
  async writeInitialMapping(file, input) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      var _a, _b;
      frontmatter.wp_title = input.title;
      frontmatter.wp_slug = (_a = input.slug) != null ? _a : "";
      frontmatter.wp_status = input.status;
      frontmatter.wp_excerpt = (_b = input.excerpt) != null ? _b : "";
      frontmatter.wp_categories = input.categories;
      frontmatter.wp_tags = input.tags;
    });
  }
  async writePublishResult(file, response) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.wp_post_id = response.id;
      frontmatter.wp_url = response.link;
      frontmatter.wp_published_at = response.date;
      frontmatter.wp_updated_at = response.modified;
    });
  }
  async writePostStatus(file, status) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.wp_status = status;
    });
  }
  async clearPublishResult(file) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.wp_post_id;
      delete frontmatter.wp_url;
      delete frontmatter.wp_published_at;
      delete frontmatter.wp_updated_at;
    });
  }
  async clearWordPressMapping(file) {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.wp_post_id;
      delete frontmatter.wp_url;
      delete frontmatter.wp_published_at;
      delete frontmatter.wp_updated_at;
      delete frontmatter.wp_title;
      delete frontmatter.wp_slug;
      delete frontmatter.wp_status;
      delete frontmatter.wp_excerpt;
      delete frontmatter.wp_categories;
      delete frontmatter.wp_tags;
    });
  }
  buildInputFromFrontmatter(metadata) {
    if (!metadata.wp_title || !metadata.wp_status) {
      throw new Error("Missing required WordPress frontmatter: wp_title and wp_status are required.");
    }
    return {
      title: metadata.wp_title,
      slug: emptyToUndefined(metadata.wp_slug),
      status: metadata.wp_status,
      excerpt: emptyToUndefined(metadata.wp_excerpt),
      categories: normalizeStringList(metadata.wp_categories),
      tags: normalizeStringList(metadata.wp_tags)
    };
  }
};
function stripFrontmatter(rawContent) {
  if (!rawContent.startsWith("---\n")) {
    return rawContent;
  }
  const end = rawContent.indexOf("\n---", 4);
  if (end === -1) {
    return rawContent;
  }
  return rawContent.slice(end + "\n---".length).replace(/^\n/, "");
}
function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
function emptyToUndefined(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// src/logger.ts
var import_obsidian = require("obsidian");
var PublishLogger = class {
  constructor(options = {}) {
    this.entries = [];
    this.debug = false;
    this.logPath = "";
    this.configure(options);
  }
  configure(options) {
    var _a;
    this.debug = Boolean(options.debug);
    this.logPath = (_a = options.logPath) != null ? _a : this.logPath;
  }
  info(message, details) {
    this.push("info", message, details);
  }
  warn(message, details) {
    this.push("warn", message, details);
  }
  error(message, details) {
    this.push("error", message, details);
  }
  dump() {
    if (this.entries.length === 0) return "No log entries were recorded for this operation.";
    return this.entries.map((entry) => {
      const details = entry.details === void 0 ? "" : `
${safeStringify(entry.details)}`;
      return `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${details}`;
    }).join("\n\n");
  }
  clear() {
    this.entries = [];
  }
  push(level, message, details) {
    const entry = { level, message, details, time: (/* @__PURE__ */ new Date()).toISOString() };
    this.entries.push(entry);
    if (this.debug) this.appendToFile(entry);
  }
  appendToFile(entry) {
    if (!this.logPath) return;
    try {
      const fs = loadFs();
      if (!fs) return;
      const path = loadPath();
      if (!path) return;
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      const details = entry.details === void 0 ? "" : ` ${safeStringify(entry.details)}`;
      fs.appendFileSync(this.logPath, `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${details}
`, "utf8");
    } catch (_error) {
    }
  }
};
function showErrorLogModal(app, title, logger, error) {
  new ErrorLogModal(app, title, buildErrorReport(title, logger, error)).open();
}
function buildErrorReport(title, logger, error) {
  const explicitError = error === void 0 ? "" : `

Thrown error:
${safeStringify(serializeError2(error))}`;
  return `${title}

${logger.dump()}${explicitError}`;
}
var ErrorLogModal = class extends import_obsidian.Modal {
  constructor(app, titleText, report) {
    super(app);
    this.titleText = titleText;
    this.report = report;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.titleText });
    contentEl.createEl("p", {
      text: "The operation failed. The error log below is for this run only."
    });
    const pre = contentEl.createEl("pre");
    pre.style.maxHeight = "55vh";
    pre.style.overflow = "auto";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.userSelect = "text";
    pre.setText(this.report);
    new import_obsidian.Setting(contentEl).addButton((button) => button.setButtonText("Copy error log").onClick(async () => {
      await navigator.clipboard.writeText(this.report);
      new import_obsidian.Notice("Error log copied", 4e3);
    })).addButton((button) => button.setCta().setButtonText("Close").onClick(() => this.close()));
  }
};
function safeStringify(value) {
  try {
    return JSON.stringify(redactSecrets(value), null, 2);
  } catch (_error) {
    return redactSecretText(String(value));
  }
}
function redactSecrets(value) {
  if (typeof value === "string") return redactSecretText(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    output[key] = isSecretKey(key) ? "[REDACTED]" : redactSecrets(item);
  });
  return output;
}
function isSecretKey(key) {
  return /authorization|password|secret|token|signature|accesskeyid|ossaccesskeyid/i.test(key);
}
function redactSecretText(value) {
  const redacted = value.replace(/(Authorization:\s*)[^\n]+/gi, "$1[REDACTED]").replace(/(Authorization\":\s*\")[^\"]+/gi, "$1[REDACTED]").replace(/(OSSAccessKeyId=)[^&\s]+/gi, "$1[REDACTED]").replace(/(Signature=)[^&\s]+/gi, "$1[REDACTED]").replace(/(Expires=)[^&\s]+/gi, "$1[REDACTED]").replace(/(AccessKeyId>)[^<]+/gi, "$1[REDACTED]").replace(/(SignatureProvided>)[^<]+/gi, "$1[REDACTED]");
  return redacted.length > 2e3 ? `${redacted.slice(0, 2e3)}
...[truncated ${redacted.length - 2e3} chars]` : redacted;
}
function serializeError2(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
function loadFs() {
  if (typeof require !== "function") return void 0;
  return require("fs");
}
function loadPath() {
  if (typeof require !== "function") return void 0;
  return require("path");
}

// src/media-cache-store.ts
var JsonlMediaCacheStore = class {
  constructor(filePath, logger) {
    this.filePath = filePath;
    this.logger = logger;
    this.entries = /* @__PURE__ */ new Map();
    this.loaded = false;
  }
  async get(vaultPath) {
    await this.ensureLoaded();
    return this.entries.get(vaultPath);
  }
  async set(entry) {
    await this.ensureLoaded();
    this.entries.set(entry.vaultPath, entry);
    await this.append({ op: "upsert", key: entry.vaultPath, value: entry, time: (/* @__PURE__ */ new Date()).toISOString() });
  }
  async delete(vaultPath) {
    await this.ensureLoaded();
    this.entries.delete(vaultPath);
    await this.append({ op: "delete", key: vaultPath, time: (/* @__PURE__ */ new Date()).toISOString() });
  }
  async list() {
    await this.ensureLoaded();
    return Array.from(this.entries.values());
  }
  async migrateFromSettingsCache(cache) {
    await this.ensureLoaded();
    const entries = Object.entries(cache != null ? cache : {});
    if (entries.length === 0) return 0;
    for (const [key, entry] of entries) {
      if (!(entry == null ? void 0 : entry.vaultPath) || !entry.url) continue;
      const normalized = { ...entry, vaultPath: entry.vaultPath || key };
      this.entries.set(normalized.vaultPath, normalized);
    }
    await this.compact();
    this.logger.info("Migrated media cache from plugin settings to JSONL store", { count: entries.length, filePath: this.filePath });
    return entries.length;
  }
  async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    const fs = loadFs2();
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, "utf8");
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      try {
        this.apply(JSON.parse(line));
      } catch (error) {
        this.logger.warn("Skipped invalid media cache JSONL line", {
          filePath: this.filePath,
          line: index + 1,
          error: serializeError3(error)
        });
      }
    }
    this.logger.info("Loaded media cache JSONL store", { filePath: this.filePath, count: this.entries.size });
  }
  apply(operation) {
    if (operation.op === "upsert") {
      this.entries.set(operation.key, operation.value);
      return;
    }
    if (operation.op === "delete") {
      this.entries.delete(operation.key);
    }
  }
  async append(operation) {
    const fs = loadFs2();
    const path = loadPath2();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(operation)}
`, "utf8");
  }
  async compact() {
    const fs = loadFs2();
    const path = loadPath2();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const lines = Array.from(this.entries.entries()).map(([key, value]) => JSON.stringify({
      op: "upsert",
      key,
      value,
      time: (/* @__PURE__ */ new Date()).toISOString()
    }));
    fs.writeFileSync(this.filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
  }
};
function loadFs2() {
  if (typeof require !== "function") throw new Error("Node fs module is unavailable in this Obsidian environment.");
  return require("fs");
}
function loadPath2() {
  if (typeof require !== "function") throw new Error("Node path module is unavailable in this Obsidian environment.");
  return require("path");
}
function serializeError3(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

// src/wordpress-client.ts
var import_obsidian2 = require("obsidian");
var WordPressClient = class {
  constructor(settings, logger) {
    this.settings = settings;
    this.logger = logger;
  }
  async getPost(postId) {
    this.logger.info("Fetching WordPress post", { postId });
    return this.request(`/wp-json/wp/v2/posts/${postId}?context=edit`, "GET");
  }
  async createOrUpdatePost(postId, payload) {
    const endpoint = postId ? `/wp-json/wp/v2/posts/${postId}` : "/wp-json/wp/v2/posts";
    this.logger.info(postId ? "Updating WordPress post" : "Creating WordPress post", { endpoint, payload });
    return this.request(endpoint, "POST", payload);
  }
  async updatePostStatus(postId, status) {
    this.logger.info("Updating WordPress post status", { postId, status });
    return this.request(`/wp-json/wp/v2/posts/${postId}`, "POST", { status });
  }
  async deletePost(postId, force) {
    this.logger.info(force ? "Deleting WordPress post permanently" : "Moving WordPress post to trash", { postId });
    return this.request(`/wp-json/wp/v2/posts/${postId}?force=${force ? "true" : "false"}`, "DELETE");
  }
  async uploadMedia(fileName, mimeType, body) {
    this.logger.info("Uploading WordPress media", { fileName, mimeType, bytes: body.byteLength });
    return this.requestBinary("/wp-json/wp/v2/media", "POST", body, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${escapeHeaderValue(fileName)}"`
    });
  }
  async getCategories() {
    this.logger.info("Fetching WordPress categories");
    return this.request("/wp-json/wp/v2/categories?per_page=100&hide_empty=false", "GET");
  }
  async createCategory(name, parent) {
    this.logger.info("Creating WordPress category", { name, parent });
    return this.request("/wp-json/wp/v2/categories", "POST", {
      name,
      ...parent ? { parent } : {}
    });
  }
  async deleteCategory(categoryId) {
    this.logger.info("Deleting WordPress category", { categoryId });
    return this.request(`/wp-json/wp/v2/categories/${categoryId}?force=true`, "DELETE");
  }
  async resolveTerms(taxonomy, names) {
    const ids = [];
    for (const name of names) {
      const existing = await this.findTerm(taxonomy, name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const created = await this.createTerm(taxonomy, name);
      ids.push(created.id);
    }
    return ids;
  }
  async findTerm(taxonomy, name) {
    this.logger.info("Looking up WordPress taxonomy term", { taxonomy, name });
    const terms = await this.request(`/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}`, "GET");
    return terms.find((term) => term.name.toLowerCase() === name.toLowerCase());
  }
  async createTerm(taxonomy, name) {
    this.logger.info("Creating WordPress taxonomy term", { taxonomy, name });
    return this.request(`/wp-json/wp/v2/${taxonomy}`, "POST", { name });
  }
  async requestBinary(path, method, body, extraHeaders) {
    return this.requestRaw(path, method, body, extraHeaders);
  }
  async request(path, method, body) {
    const headers = {};
    let requestBody;
    if (body !== void 0) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }
    return this.requestRaw(path, method, requestBody, headers);
  }
  async requestRaw(path, method, body, extraHeaders = {}) {
    var _a;
    const siteUrl = this.settings.siteUrl.replace(/\/$/, "");
    const url = `${siteUrl}${path}`;
    const headers = {
      Authorization: `Basic ${btoa(`${this.settings.username}:${this.settings.applicationPassword}`)}`,
      ...extraHeaders
    };
    const response = await (0, import_obsidian2.requestUrl)({
      url,
      method,
      headers,
      body,
      throw: false
    });
    this.logger.info("WordPress REST response", {
      url,
      method,
      status: response.status,
      headers,
      body: (_a = response.json) != null ? _a : response.text
    });
    if (response.status < 200 || response.status >= 300) {
      const errorText = typeof response.text === "string" ? response.text : JSON.stringify(response.json);
      throw new Error(`WordPress REST request failed: ${response.status} ${errorText}`);
    }
    return response.json;
  }
};
function escapeHeaderValue(value) {
  return value.replace(/["\r\n]/g, "_");
}

// src/published-posts-service.ts
var PublishedPostsService = class {
  constructor(app, settings, logger) {
    this.app = app;
    this.settings = settings;
    this.logger = logger;
    this.frontmatter = new FrontmatterService(app);
  }
  async listPublishedPosts() {
    const files = this.app.vault.getMarkdownFiles();
    const client = new WordPressClient(this.settings, this.logger);
    const results = [];
    for (const file of files) {
      const item = await this.buildStatusItem(file, client);
      if (item) results.push(item);
    }
    this.logger.info("Listed published Obsidian WordPress posts", { count: results.length });
    return results;
  }
  async buildStatusItem(file, client) {
    const metadata = this.frontmatter.read(file);
    if (!metadata.wp_post_id) return void 0;
    const item = {
      notePath: file.path,
      postId: metadata.wp_post_id,
      localTitle: metadata.wp_title,
      localStatus: metadata.wp_status,
      localUrl: metadata.wp_url,
      localUpdatedAt: metadata.wp_updated_at
    };
    try {
      item.remote = summarizeRemotePost(await client.getPost(metadata.wp_post_id));
    } catch (error) {
      item.error = error instanceof Error ? error.message : "Failed to fetch remote post status";
      this.logger.warn("Failed to fetch remote status for published note", { file: file.path, postId: metadata.wp_post_id, error: item.error });
    }
    return item;
  }
};
function summarizeRemotePost(remote) {
  var _a;
  return {
    id: remote.id,
    status: remote.status,
    link: remote.link,
    date: remote.date,
    modified: remote.modified,
    title: (_a = remote.title) == null ? void 0 : _a.rendered,
    slug: remote.slug,
    type: remote.type
  };
}

// src/publisher.ts
var import_obsidian10 = require("obsidian");

// src/endpoint-switch-modal.ts
var import_obsidian3 = require("obsidian");
function confirmEndpointSwitch(app, currentEndpoint, recommendedEndpoint) {
  return new Promise((resolve) => {
    new EndpointSwitchModal(app, currentEndpoint, recommendedEndpoint, resolve).open();
  });
}
var EndpointSwitchModal = class extends import_obsidian3.Modal {
  constructor(app, currentEndpoint, recommendedEndpoint, resolve) {
    super(app);
    this.currentEndpoint = currentEndpoint;
    this.recommendedEndpoint = recommendedEndpoint;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "OSS endpoint mismatch" });
    contentEl.createEl("p", {
      text: "Aliyun says this bucket must be accessed through a different endpoint."
    });
    contentEl.createEl("p", { text: `Current: ${this.currentEndpoint || "(empty)"}` });
    contentEl.createEl("p", { text: `Recommended: ${this.recommendedEndpoint}` });
    new import_obsidian3.Setting(contentEl).addButton((button) => button.setButtonText("Keep current").onClick(() => this.finish(false))).addButton((button) => button.setCta().setButtonText("Switch endpoint").onClick(() => this.finish(true)));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.finish(false);
  }
  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
};

// src/image-compressor.ts
var BrowserImageCompressor = class {
  constructor(logger) {
    this.logger = logger;
  }
  async prepare(file, body, mimeType, quality) {
    var _a;
    if (!isCompressibleMimeType(mimeType)) {
      return this.original(file, body, mimeType, "Image type is not safely compressible");
    }
    try {
      const bitmap = await createImageBitmap(new Blob([body], { type: mimeType }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) return this.original(file, body, mimeType, "Canvas 2D context is unavailable");
      context.drawImage(bitmap, 0, 0);
      (_a = bitmap.close) == null ? void 0 : _a.call(bitmap);
      const targetMimeType = mimeType === "image/png" && hasAlpha(context, canvas.width, canvas.height) ? "image/png" : mimeType === "image/webp" ? "image/webp" : "image/jpeg";
      const blob = await canvasToBlob(canvas, targetMimeType, clampQuality(quality));
      if (!blob) return this.original(file, body, mimeType, "Canvas compression produced no output");
      const compressedBody = await blob.arrayBuffer();
      if (compressedBody.byteLength >= body.byteLength) {
        return this.original(file, body, mimeType, "Compressed image is not smaller than original");
      }
      const prepared = {
        body: compressedBody,
        mimeType: targetMimeType,
        fileName: replaceExtension(file.name, extensionForMimeType(targetMimeType)),
        originalBytes: body.byteLength,
        uploadBytes: compressedBody.byteLength,
        compressed: true
      };
      this.logger.info("Compressed image", {
        path: file.path,
        originalBytes: prepared.originalBytes,
        uploadBytes: prepared.uploadBytes,
        mimeType: prepared.mimeType
      });
      return prepared;
    } catch (error) {
      this.logger.warn("Image compression failed; uploading original image", serializeError4(error));
      return this.original(file, body, mimeType, "Compression failed");
    }
  }
  original(file, body, mimeType, reason) {
    this.logger.info("Using original image bytes", { path: file.path, reason, bytes: body.byteLength, mimeType });
    return {
      body,
      mimeType,
      fileName: file.name,
      originalBytes: body.byteLength,
      uploadBytes: body.byteLength,
      compressed: false
    };
  }
};
function isCompressibleMimeType(mimeType) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}
function hasAlpha(context, width, height) {
  const data = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}
function clampQuality(value) {
  if (Number.isNaN(value)) return 0.82;
  return Math.min(1, Math.max(0.1, value));
}
function extensionForMimeType(mimeType) {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return "jpg";
}
function replaceExtension(fileName, extension) {
  return fileName.replace(/\.[^.]+$/, `.${extension}`);
}
function serializeError4(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

// src/media-url-checker.ts
var import_obsidian4 = require("obsidian");
var HttpMediaUrlChecker = class {
  constructor(logger) {
    this.logger = logger;
  }
  async check(url, referer) {
    this.logger.info("Checking cached media URL", { url, referer });
    const headers = referer ? { Referer: referer } : void 0;
    try {
      const head = await (0, import_obsidian4.requestUrl)({ url, method: "HEAD", headers, throw: false });
      const headStatus = classifyStatus(head.status);
      if (headStatus !== "unknown") {
        this.logger.info("Cached media HEAD check completed", { url, status: head.status, result: headStatus });
        return headStatus;
      }
      const get = await (0, import_obsidian4.requestUrl)({
        url,
        method: "GET",
        headers: { ...headers != null ? headers : {}, Range: "bytes=0-0" },
        throw: false
      });
      const getStatus = classifyStatus(get.status);
      this.logger.info("Cached media GET check completed", { url, status: get.status, result: getStatus });
      return getStatus;
    } catch (error) {
      this.logger.warn("Cached media URL check failed due to network or client error", serializeError5(error));
      return "unknown";
    }
  }
};
function classifyStatus(status) {
  if (status >= 200 && status < 400 || status === 206) return "available";
  if (status === 404 || status === 410) return "missing";
  return "unknown";
}
function serializeError5(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

// src/storage/aliyun-oss-provider.ts
var import_obsidian5 = require("obsidian");

// src/storage/object-key-builder.ts
async function buildObjectKey(rule, input) {
  const now = /* @__PURE__ */ new Date();
  const extension = getExtension(input.fileName);
  const fileBaseName = input.fileName.slice(0, input.fileName.length - extension.length - 1);
  const hash = await sha256Hex(input.body);
  const values = {
    postTitle: input.postTitle,
    fileName: input.fileName,
    fileBaseName,
    ext: extension,
    yyyy: String(now.getFullYear()),
    mm: String(now.getMonth() + 1).padStart(2, "0"),
    dd: String(now.getDate()).padStart(2, "0"),
    hash: hash.slice(0, 16)
  };
  const expanded = (rule || "obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}").replace(/\{([a-zA-Z]+)\}/g, (_match, token) => {
    var _a;
    return (_a = values[token]) != null ? _a : "";
  }).replace(/^\/+/, "");
  return expanded.split("/").map((segment) => sanitizeSegment(segment)).filter(Boolean).join("/");
}
function sanitizeSegment(value) {
  return value.trim().replace(/[\\:*?"<>|]/g, "-").replace(/\s+/g, "-");
}
function getExtension(fileName) {
  var _a;
  const match = fileName.match(/\.([^.]+)$/);
  return (_a = match == null ? void 0 : match[1]) != null ? _a : "bin";
}
async function sha256Hex(body) {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// src/storage/aliyun-oss-provider.ts
var AliyunOssStorageProvider = class {
  constructor(settings, logger) {
    this.settings = settings;
    this.logger = logger;
    this.id = "aliyun-oss";
  }
  async uploadImage(input) {
    this.assertReady();
    const objectKey = await buildObjectKey(this.settings.objectKeyRule, input);
    const date = (/* @__PURE__ */ new Date()).toUTCString();
    const resource = `/${this.settings.bucket}/${objectKey}`;
    const signature = await signOssV1("PUT", input.mimeType, date, resource, this.settings.accessKeySecret);
    const encodedObjectKey = encodeObjectKeyPath(objectKey);
    const url = `${this.uploadBaseUrl()}/${encodedObjectKey}`;
    this.logger.info("Uploading image to Aliyun OSS", {
      bucket: this.settings.bucket,
      endpoint: this.settings.endpoint,
      objectKey,
      mimeType: input.mimeType,
      bytes: input.body.byteLength
    });
    const response = await (0, import_obsidian5.requestUrl)({
      url,
      method: "PUT",
      headers: {
        Authorization: `OSS ${this.settings.accessKeyId}:${signature}`,
        Date: date,
        "Content-Type": input.mimeType
      },
      body: input.body,
      throw: false
    });
    this.logger.info("Aliyun OSS PUT response", { status: response.status, text: response.text });
    if (response.status < 200 || response.status >= 300) {
      throw buildOssUploadError(response.status, response.text, this.settings);
    }
    return {
      provider: this.id,
      url: `${this.publicBaseUrl()}/${encodedObjectKey}`,
      objectKey,
      uploadedFileName: input.fileName,
      mimeType: input.mimeType
    };
  }
  assertReady() {
    const missing = [];
    if (!this.settings.endpoint) missing.push("OSS endpoint");
    if (!this.settings.bucket) missing.push("OSS bucket");
    if (!this.settings.accessKeyId) missing.push("AccessKey ID");
    if (!this.settings.accessKeySecret) missing.push("AccessKey Secret");
    if (!this.settings.publicBaseUrl) missing.push("Public base URL");
    if (missing.length > 0) throw new Error(`Aliyun OSS settings incomplete: ${missing.join(", ")}.`);
  }
  uploadBaseUrl() {
    const endpoint = trimTrailingSlash(this.settings.endpoint);
    const host = endpoint.replace(/^https?:\/\//, "");
    if (host.startsWith(`${this.settings.bucket}.`)) return endpoint;
    const protocol = endpoint.startsWith("http://") ? "http://" : "https://";
    return `${protocol}${this.settings.bucket}.${host}`;
  }
  publicBaseUrl() {
    return normalizePublicBaseUrl(this.settings.publicBaseUrl, this.logger);
  }
};
async function signOssV1(method, contentType, date, canonicalizedResource, accessKeySecret) {
  const stringToSign = `${method}

${contentType}
${date}
${canonicalizedResource}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(accessKeySecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  return arrayBufferToBase64(signature);
}
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
function normalizePublicBaseUrl(value, logger) {
  try {
    const url = new URL(value);
    if (url.search || url.hash) {
      logger.warn("OSS public base URL contains query or hash; stripping it before inserting image URLs", {
        original: value,
        stripped: `${url.origin}${url.pathname}`
      });
      url.search = "";
      url.hash = "";
    }
    return trimTrailingSlash(url.toString());
  } catch (_error) {
    return trimTrailingSlash(value.split(/[?#]/)[0]);
  }
}
function encodeObjectKeyPath(objectKey) {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}
var AliyunOssEndpointMismatchError = class extends Error {
  constructor(message, currentEndpoint, recommendedEndpoint) {
    super(message);
    this.currentEndpoint = currentEndpoint;
    this.recommendedEndpoint = recommendedEndpoint;
    this.name = "AliyunOssEndpointMismatchError";
  }
};
function buildOssUploadError(status, rawText, settings) {
  var _a;
  const parsed = parseOssError(rawText);
  const message = buildFriendlyOssError(status, rawText, settings, parsed);
  if (parsed.endpoint && /specified endpoint/i.test((_a = parsed.message) != null ? _a : "")) {
    return new AliyunOssEndpointMismatchError(message, settings.endpoint, `https://${parsed.endpoint}`);
  }
  return new Error(message);
}
function buildFriendlyOssError(status, rawText, settings, parsed = parseOssError(rawText)) {
  const summary = explainOssError(status, parsed, settings);
  const details = [
    `HTTP status: ${status}`,
    parsed.code ? `OSS code: ${parsed.code}` : void 0,
    parsed.message ? `OSS message: ${parsed.message}` : void 0,
    parsed.endpoint ? `Suggested endpoint: https://${parsed.endpoint}` : void 0,
    parsed.bucket ? `Bucket: ${parsed.bucket}` : void 0,
    parsed.requestId ? `RequestId: ${parsed.requestId}` : void 0,
    parsed.ec ? `EC: ${parsed.ec}` : void 0
  ].filter(Boolean).join("\n");
  return `Aliyun OSS upload failed. ${summary}

${details}`;
}
function explainOssError(status, parsed, settings) {
  var _a;
  if (parsed.endpoint && /specified endpoint/i.test((_a = parsed.message) != null ? _a : "")) {
    return `The bucket is in a different region than your configured endpoint. Change OSS endpoint from ${settings.endpoint || "(empty)"} to https://${parsed.endpoint}.`;
  }
  if (parsed.code === "SignatureDoesNotMatch") {
    return "The OSS request signature did not match. This is usually caused by a wrong AccessKey Secret, wrong bucket/endpoint, system time drift, or an object-key signing mismatch.";
  }
  if (parsed.code === "InvalidAccessKeyId") {
    return "The AccessKey ID is invalid or disabled. Check the configured AccessKey ID.";
  }
  if (parsed.code === "AccessDenied") {
    return "OSS denied this upload. Check bucket permissions, RAM policy, endpoint region, and whether this AccessKey can put objects into the bucket.";
  }
  if (parsed.code === "NoSuchBucket") {
    return "The bucket does not exist or is not accessible from the configured endpoint. Check bucket name and region.";
  }
  if (parsed.code === "InvalidBucketName") {
    return "The configured bucket name is invalid. Check the OSS bucket setting.";
  }
  if (status === 403) {
    return "OSS returned 403 Forbidden. This is usually caused by wrong credentials, missing RAM permissions, wrong endpoint region, or bucket policy restrictions.";
  }
  return "Aliyun OSS returned an error response. See the details below for the raw error summary.";
}
function parseOssError(rawText) {
  return {
    code: extractXmlTag(rawText, "Code"),
    message: extractXmlTag(rawText, "Message"),
    requestId: extractXmlTag(rawText, "RequestId"),
    hostId: extractXmlTag(rawText, "HostId"),
    bucket: extractXmlTag(rawText, "Bucket"),
    endpoint: extractXmlTag(rawText, "Endpoint"),
    ec: extractXmlTag(rawText, "EC")
  };
}
function extractXmlTag(xml, tag) {
  var _a;
  const match = xml.match(new RegExp(`<${tag}>([sS]*?)</${tag}>`, "i"));
  return (_a = match == null ? void 0 : match[1]) == null ? void 0 : _a.trim();
}

// src/storage/wordpress-media-provider.ts
var WordPressMediaStorageProvider = class {
  constructor(client) {
    this.client = client;
    this.id = "wordpress";
  }
  async uploadImage(input) {
    const response = await this.client.uploadMedia(input.fileName, input.mimeType, input.body);
    return {
      provider: this.id,
      url: response.source_url || response.link,
      mediaId: response.id,
      uploadedFileName: input.fileName,
      mimeType: input.mimeType
    };
  }
};

// src/storage/image-storage-provider.ts
function createImageStorageProvider(settings, wordpressClient, logger) {
  if (settings.imageStorageProvider === "aliyun-oss") {
    return new AliyunOssStorageProvider(settings.aliyunOss, logger);
  }
  if (!wordpressClient) {
    throw new Error("WordPress media storage requires a WordPress client.");
  }
  return new WordPressMediaStorageProvider(wordpressClient);
}
function createTestImageUploadInput(objectKeyRule) {
  return {
    vaultPath: "oss-test-image.png",
    postTitle: "oss-test",
    fileName: "oss-test-image.png",
    mimeType: "image/png",
    body: base64ToArrayBuffer("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lEao0wAAAABJRU5ErkJggg=="),
    originalSize: 70,
    uploadSize: 70,
    compressed: false
  };
}
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

// src/upload-confirm-modal.ts
var import_obsidian6 = require("obsidian");
function confirmLargeImageUpload(app, info) {
  return new Promise((resolve) => {
    new LargeImageUploadModal(app, info, resolve).open();
  });
}
var LargeImageUploadModal = class extends import_obsidian6.Modal {
  constructor(app, info, resolve) {
    super(app);
    this.info = info;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Large image upload" });
    contentEl.createEl("p", {
      text: `${this.info.fileName} is ${formatBytes(this.info.uploadBytes)} after processing, which exceeds your ${formatBytes(this.info.thresholdBytes)} threshold.`
    });
    contentEl.createEl("p", {
      text: this.info.compressed ? `Original size: ${formatBytes(this.info.originalBytes)}. The image was compressed before this check.` : "This image could not be compressed smaller, so the original file will be uploaded."
    });
    new import_obsidian6.Setting(contentEl).addButton((button) => button.setButtonText("Cancel upload").onClick(() => this.finish(false))).addButton((button) => button.setCta().setButtonText("Upload anyway").onClick(() => this.finish(true)));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.finish(false);
  }
  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
};
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// src/image-assets.ts
var WordPressImageAssetProcessor = class {
  constructor(app, client, settings, logger, mediaCacheStore, persistSettings) {
    this.app = app;
    this.client = client;
    this.settings = settings;
    this.logger = logger;
    this.mediaCacheStore = mediaCacheStore;
    this.persistSettings = persistSettings;
    this.uploadedByPath = /* @__PURE__ */ new Map();
    this.currentPostTitle = "untitled";
    this.compressor = new BrowserImageCompressor(logger);
    this.mediaUrlChecker = new HttpMediaUrlChecker(logger);
    this.storageProvider = createImageStorageProvider(settings, client, logger);
  }
  async rewriteMarkdownImages(markdown, sourcePath, postTitle) {
    this.currentPostTitle = postTitle || "untitled";
    this.logger.info("Rewriting local Markdown images for WordPress", { sourcePath, postTitle: this.currentPostTitle });
    const chunks = splitByFencedCodeBlocks(markdown);
    const rewritten = [];
    for (const chunk of chunks) {
      if (chunk.kind === "fence" && !isAdmonitionFence(chunk.text)) {
        rewritten.push(chunk.text);
        continue;
      }
      rewritten.push(await this.rewriteImageReferences(chunk.text, sourcePath));
    }
    return rewritten.join("");
  }
  async rewriteImageReferences(markdown, sourcePath) {
    const withObsidianEmbeds = await replaceAsync(
      markdown,
      /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      async (_match, rawTarget, rawAlias) => {
        const file = this.resolveLocalImage(rawTarget, sourcePath);
        if (!file) {
          this.logger.warn("Could not resolve Obsidian image embed", { target: rawTarget, sourcePath });
          return _match;
        }
        const uploaded = await this.uploadImage(file, normalizeAlt(rawAlias, file));
        return `![${escapeMarkdownAlt(uploaded.alt)}](${uploaded.url})`;
      }
    );
    return replaceAsync(
      withObsidianEmbeds,
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      async (_match, rawAlt, rawTarget) => {
        const parsed = parseMarkdownImageTarget(rawTarget);
        if (!parsed || isRemoteOrDataUrl(parsed.path)) return _match;
        const file = this.resolveLocalImage(parsed.path, sourcePath);
        if (!file) {
          this.logger.warn("Could not resolve Markdown image", { target: parsed.path, sourcePath });
          return _match;
        }
        const uploaded = await this.uploadImage(file, rawAlt.trim() || file.basename);
        return `![${escapeMarkdownAlt(uploaded.alt)}](${uploaded.url}${parsed.title ? ` ${parsed.title}` : ""})`;
      }
    );
  }
  resolveLocalImage(target, sourcePath) {
    const decodedTarget = safeDecodeUri(stripAngleBrackets(target.trim()));
    const file = this.app.metadataCache.getFirstLinkpathDest(decodedTarget, sourcePath);
    if (!file || !isImageExtension(file.extension)) return null;
    return file;
  }
  async uploadImage(file, alt) {
    const cached = this.uploadedByPath.get(file.path);
    if (cached) {
      this.logger.info("Reusing uploaded image in current publish", { path: file.path, url: cached.url });
      return cached;
    }
    const persistentCache = await this.getValidPersistentCache(file);
    if (persistentCache) {
      const remoteStatus = await this.mediaUrlChecker.check(persistentCache.url);
      if (remoteStatus === "available" || remoteStatus === "unknown") {
        const uploaded2 = { url: persistentCache.url, alt };
        this.uploadedByPath.set(file.path, uploaded2);
        this.logger.info("Reusing persisted media URL", {
          path: file.path,
          url: persistentCache.url,
          mediaId: persistentCache.mediaId,
          objectKey: persistentCache.objectKey,
          provider: persistentCache.provider,
          remoteStatus
        });
        return uploaded2;
      }
      this.logger.warn("Cached media URL is missing; image will be re-uploaded", {
        path: file.path,
        url: persistentCache.url,
        mediaId: persistentCache.mediaId,
        objectKey: persistentCache.objectKey,
        provider: persistentCache.provider
      });
      await this.mediaCacheStore.delete(file.path);
    }
    const mimeType = getImageMimeType(file.extension);
    const originalBody = await this.app.vault.readBinary(file);
    const prepared = await this.compressor.prepare(
      file,
      originalBody,
      mimeType,
      this.settings.imageCompressionQuality
    );
    const thresholdBytes = this.settings.largeImageThresholdMb * 1024 * 1024;
    if (thresholdBytes > 0 && prepared.uploadBytes > thresholdBytes) {
      const shouldUpload = await confirmLargeImageUpload(this.app, {
        fileName: prepared.fileName,
        originalBytes: prepared.originalBytes,
        uploadBytes: prepared.uploadBytes,
        thresholdBytes,
        compressed: prepared.compressed
      });
      if (!shouldUpload) {
        throw new Error(`Image upload canceled: ${file.path}`);
      }
    }
    const uploadInput = {
      vaultPath: file.path,
      postTitle: this.currentPostTitle,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      body: prepared.body,
      originalSize: prepared.originalBytes,
      uploadSize: prepared.uploadBytes,
      compressed: prepared.compressed
    };
    const response = await this.uploadWithEndpointMismatchRecovery(uploadInput);
    const uploaded = { url: response.url, alt };
    this.uploadedByPath.set(file.path, uploaded);
    await this.writePersistentCache(file, {
      vaultPath: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      compressionQuality: this.settings.imageCompressionQuality,
      provider: response.provider,
      mediaId: response.mediaId,
      objectKey: response.objectKey,
      url: uploaded.url,
      mimeType: response.mimeType,
      uploadedFileName: response.uploadedFileName,
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    this.logger.info("Uploaded image to WordPress", {
      path: file.path,
      url: uploaded.url,
      mediaId: response.mediaId,
      objectKey: response.objectKey,
      provider: response.provider,
      originalBytes: prepared.originalBytes,
      uploadBytes: prepared.uploadBytes,
      compressed: prepared.compressed
    });
    return uploaded;
  }
  async uploadWithEndpointMismatchRecovery(uploadInput) {
    try {
      return await this.storageProvider.uploadImage(uploadInput);
    } catch (error) {
      if (!(error instanceof AliyunOssEndpointMismatchError)) throw error;
      const shouldSwitch = await confirmEndpointSwitch(this.app, error.currentEndpoint, error.recommendedEndpoint);
      if (!shouldSwitch) throw error;
      this.settings.aliyunOss.endpoint = error.recommendedEndpoint;
      await this.persistSettings();
      this.storageProvider = createImageStorageProvider(this.settings, this.client, this.logger);
      this.logger.info("Retrying image upload after OSS endpoint switch", {
        recommendedEndpoint: error.recommendedEndpoint
      });
      return this.storageProvider.uploadImage(uploadInput);
    }
  }
  async getValidPersistentCache(file) {
    const entry = await this.mediaCacheStore.get(file.path);
    if (!entry) return void 0;
    if (entry.vaultPath !== file.path) return void 0;
    if (entry.size !== file.stat.size) return void 0;
    if (entry.mtime !== file.stat.mtime) return void 0;
    if (entry.compressionQuality !== this.settings.imageCompressionQuality) return void 0;
    if (entry.provider !== this.settings.imageStorageProvider) return void 0;
    if (!entry.url) return void 0;
    return entry;
  }
  async writePersistentCache(file, entry) {
    await this.mediaCacheStore.set(entry);
  }
};
function splitByFencedCodeBlocks(markdown) {
  const chunks = [];
  const fenceRegex = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
  let lastIndex = 0;
  let match;
  while ((match = fenceRegex.exec(markdown)) !== null) {
    const fenceStart = match.index + match[1].length;
    if (fenceStart > lastIndex) {
      chunks.push({ kind: "text", text: markdown.slice(lastIndex, fenceStart) });
    }
    chunks.push({ kind: "fence", text: markdown.slice(fenceStart, fenceRegex.lastIndex) });
    lastIndex = fenceRegex.lastIndex;
  }
  if (lastIndex < markdown.length) {
    chunks.push({ kind: "text", text: markdown.slice(lastIndex) });
  }
  return chunks;
}
async function replaceAsync(value, regex, replacer) {
  var _a;
  const matches = Array.from(value.matchAll(regex));
  if (matches.length === 0) return value;
  let output = "";
  let lastIndex = 0;
  for (const match of matches) {
    output += value.slice(lastIndex, match.index);
    output += await replacer(...match);
    lastIndex = ((_a = match.index) != null ? _a : 0) + match[0].length;
  }
  output += value.slice(lastIndex);
  return output;
}
function isAdmonitionFence(fence) {
  var _a;
  const match = fence.match(/^(```|~~~)([^\n]*)\n/);
  const language = (_a = match == null ? void 0 : match[2].trim().split(/\s+/)[0]) == null ? void 0 : _a.toLowerCase();
  return Boolean(language == null ? void 0 : language.startsWith("ad-"));
}
function parseMarkdownImageTarget(rawTarget) {
  const target = rawTarget.trim();
  if (!target) return null;
  const angleMatch = target.match(/^<([^>]+)>(.*)$/);
  if (angleMatch) {
    const title = angleMatch[2].trim();
    return { path: angleMatch[1], title: title || void 0 };
  }
  const titleMatch = target.match(/^(.*?)(\s+["'][^"']+["'])$/);
  if (titleMatch) {
    return { path: titleMatch[1].trim(), title: titleMatch[2].trim() };
  }
  return { path: target };
}
function normalizeAlt(rawAlias, file) {
  const alias = rawAlias == null ? void 0 : rawAlias.trim();
  if (!alias) return file.basename;
  if (/^\d+(x\d+)?$/.test(alias)) return file.basename;
  return alias;
}
function isRemoteOrDataUrl(value) {
  return /^(https?:|data:|app:|file:|mailto:)/i.test(value);
}
function isImageExtension(extension) {
  return ["apng", "avif", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extension.toLowerCase());
}
function getImageMimeType(extension) {
  var _a;
  const mimeTypes = {
    apng: "image/apng",
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp"
  };
  return (_a = mimeTypes[extension.toLowerCase()]) != null ? _a : "application/octet-stream";
}
function stripAngleBrackets(value) {
  return value.replace(/^<(.+)>$/, "$1");
}
function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}
function escapeMarkdownAlt(value) {
  return value.replace(/[\[\]\\]/g, "\\$&");
}

// src/markdown-converter.ts
var import_obsidian7 = require("obsidian");

// src/special-formats.ts
var ObsidianSpecialFormatTransformer = class {
  constructor(logger) {
    this.logger = logger;
    this.placeholders = [];
  }
  beforeRender(markdown) {
    this.placeholders = [];
    this.logger.info("Applying Obsidian special-format preprocessing");
    const chunks = splitByFencedCodeBlocks2(markdown);
    return chunks.map((chunk) => {
      if (chunk.kind === "fence") {
        return this.processFence(chunk.text);
      }
      return this.processMarkdownText(chunk.text);
    }).join("");
  }
  afterRender(html) {
    this.logger.info("Applying Obsidian special-format HTML postprocessing", {
      placeholders: this.placeholders.map((placeholder) => placeholder.kind)
    });
    let output = html;
    for (const placeholder of this.placeholders) {
      output = replaceRenderedPlaceholder(output, placeholder.token, renderPlaceholder(placeholder));
    }
    return normalizeCodeBlocks(normalizeTables(normalizeRenderedImages(normalizeAdmonitionCallouts(output))));
  }
  processFence(fence) {
    var _a;
    const match = fence.match(/^(```|~~~)([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/);
    if (!match) return fence;
    const language = (_a = match[2].trim().split(/\s+/)[0]) == null ? void 0 : _a.toLowerCase();
    const body = match[3];
    if (language === "mermaid") return fence;
    if (language === "flowchart" || language === "flow") return this.createPlaceholder("flowchart", body);
    return fence;
  }
  processMarkdownText(text) {
    return transformInlineFormatting(
      protectMath(removeObsidianComments(text), (kind, value) => this.createPlaceholder(kind, value))
    );
  }
  createPlaceholder(kind, value) {
    const token = `OWP_SPECIAL_FORMAT_${this.placeholders.length}`;
    this.placeholders.push({ token, kind, value });
    return token;
  }
};
function splitByFencedCodeBlocks2(markdown) {
  const chunks = [];
  const fenceRegex = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
  let lastIndex = 0;
  let match;
  while ((match = fenceRegex.exec(markdown)) !== null) {
    const fenceStart = match.index + match[1].length;
    if (fenceStart > lastIndex) {
      chunks.push({ kind: "text", text: markdown.slice(lastIndex, fenceStart) });
    }
    chunks.push({ kind: "fence", text: markdown.slice(fenceStart, fenceRegex.lastIndex) });
    lastIndex = fenceRegex.lastIndex;
  }
  if (lastIndex < markdown.length) {
    chunks.push({ kind: "text", text: markdown.slice(lastIndex) });
  }
  return chunks;
}
function removeObsidianComments(markdown) {
  return markdown.replace(/%%[\s\S]*?%%/g, "");
}
function protectMath(markdown, createPlaceholder) {
  const blockProtected = markdown.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, body) => {
    return createPlaceholder("math-block", body);
  });
  return blockProtected.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_match, prefix, body) => {
    return `${prefix}${createPlaceholder("math-inline", body)}`;
  });
}
function transformInlineFormatting(markdown) {
  return markdown.replace(/==([^=\n][^\n]*?)==/g, (_match, body) => `<mark>${body}</mark>`).replace(/~~([^~\n][^\n]*?)~~/g, (_match, body) => `<del>${body}</del>`);
}
function replaceRenderedPlaceholder(html, token, replacement) {
  const escapedToken = escapeRegExp(token);
  return html.replace(new RegExp(`<p>\\s*${escapedToken}\\s*</p>`, "g"), replacement).replace(new RegExp(escapedToken, "g"), replacement);
}
function normalizeCodeBlocks(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  let codeBlockIndex = 0;
  container.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    normalizeCodeLanguageClasses(pre, code);
    const copySourceId = `owp-code-source-${codeBlockIndex++}`;
    code.id = copySourceId;
    const copyToastId = `owp-code-toast-${codeBlockIndex}`;
    pre.classList.add("owp-code-block");
    appendInlineStyle(pre, [
      "position:relative",
      "box-sizing:border-box",
      "overflow:auto",
      "padding:1em",
      "padding-right:3.25em",
      "border:1px solid rgba(0,0,0,0.12)",
      "border-radius:8px",
      "background:#f7f7f8",
      "line-height:1.55",
      "color:#1f2937",
      "font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
    ]);
    appendInlineStyle(code, [
      "display:block",
      "overflow-x:auto",
      "white-space:pre",
      "background:transparent",
      "color:#1f2937",
      "font-family:inherit",
      "font-size:0.95em"
    ]);
    normalizeCodeHighlightTokens(code);
    const copyToast = document.createElement("span");
    copyToast.id = copyToastId;
    copyToast.textContent = "Copied";
    copyToast.setAttribute("aria-hidden", "true");
    appendInlineStyle(copyToast, [
      "position:absolute",
      "top:0.8em",
      "right:3.35em",
      "padding:0.22em 0.55em",
      "border-radius:999px",
      "background:#111827",
      "color:#ffffff",
      "font-size:0.75em",
      "line-height:1.2",
      "white-space:nowrap",
      "box-shadow:0 2px 8px rgba(0,0,0,0.18)",
      "opacity:0",
      "transform:translateY(-4px)",
      "pointer-events:none",
      "transition:opacity 140ms ease, transform 140ms ease"
    ]);
    pre.appendChild(copyToast);
    pre.querySelectorAll(".copy-code-button").forEach((button) => {
      const copyScript = buildCopyButtonScript(copySourceId, copyToastId);
      button.setAttribute("type", "button");
      button.setAttribute("aria-label", button.getAttribute("aria-label") || "Copy code");
      button.setAttribute("title", button.getAttribute("title") || "Copy code");
      button.setAttribute("onclick", copyScript);
      appendInlineStyle(button, [
        "position:absolute",
        "top:0.55em",
        "right:0.55em",
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:2em",
        "height:2em",
        "min-width:2em",
        "min-height:2em",
        "padding:0",
        "margin:0",
        "border:1px solid rgba(0,0,0,0.16)",
        "border-radius:6px",
        "background:#ffffff",
        "color:#455a64",
        "line-height:1",
        "box-shadow:0 1px 2px rgba(0,0,0,0.08)",
        "cursor:pointer"
      ]);
    });
    pre.querySelectorAll(".copy-code-button svg").forEach((svg) => {
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      appendInlineStyle(svg, [
        "display:block",
        "width:1em",
        "height:1em",
        "max-width:1em",
        "max-height:1em",
        "min-width:0",
        "min-height:0"
      ]);
    });
  });
  return container.innerHTML;
}
function normalizeCodeHighlightTokens(code) {
  const tokenStyles = [
    [".token.comment, .token.prolog, .token.doctype, .token.cdata", ["color:#6b7280", "font-style:italic"]],
    [".token.punctuation, .token.operator", ["color:#475569"]],
    [".token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted", ["color:#b91c1c"]],
    [".token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted", ["color:#047857"]],
    [".token.atrule, .token.attr-value, .token.keyword", ["color:#7c3aed", "font-weight:600"]],
    [".token.function, .token.class-name", ["color:#1d4ed8"]],
    [".token.regex, .token.important, .token.variable", ["color:#c2410c"]],
    [".token.url", ["color:#0f766e", "text-decoration:underline"]]
  ];
  for (const [selector, styles] of tokenStyles) {
    code.querySelectorAll(selector).forEach((token) => appendInlineStyle(token, styles));
  }
}
function normalizeCodeLanguageClasses(pre, code) {
  const normalizedLanguage = detectNormalizedLanguage(pre, code);
  stripLanguageClasses(pre);
  stripLanguageClasses(code);
  if (!normalizedLanguage) return;
  pre.classList.add(`language-${normalizedLanguage}`);
  code.classList.add(`language-${normalizedLanguage}`);
}
function detectNormalizedLanguage(pre, code) {
  const classes = [
    ...Array.from(pre.classList),
    ...Array.from(code.classList)
  ];
  for (const className of classes) {
    const raw = extractLanguageName(className);
    if (!raw) continue;
    const normalized = normalizeLanguageName(raw);
    if (normalized) return normalized;
  }
  return void 0;
}
function extractLanguageName(className) {
  if (className.startsWith("language-")) return className.slice("language-".length);
  if (className.startsWith("lang-")) return className.slice("lang-".length);
  return void 0;
}
function stripLanguageClasses(element) {
  Array.from(element.classList).forEach((className) => {
    if (className === "language-none" || className.startsWith("language-") || className.startsWith("lang-")) {
      element.classList.remove(className);
    }
  });
}
function normalizeLanguageName(raw) {
  var _a;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return void 0;
  const aliases = {
    "c++": "cpp",
    "cpp": "cpp",
    "c#": "csharp",
    "cs": "csharp",
    "js": "javascript",
    "ts": "typescript",
    "shell": "bash",
    "sh": "bash",
    "html": "markup",
    "xml": "markup"
  };
  const lowered = trimmed.toLowerCase();
  return (_a = aliases[lowered]) != null ? _a : lowered.replace(/[^a-z0-9_-]+/g, "");
}
function buildCopyButtonScript(copySourceId, copyToastId) {
  const escapedId = JSON.stringify(copySourceId);
  const escapedToastId = JSON.stringify(copyToastId);
  return [
    "(function(button){",
    `var source=document.getElementById(${escapedId});`,
    `var toast=document.getElementById(${escapedToastId});`,
    "if(!source)return;",
    "var text=source.innerText||source.textContent||'';",
    "var onSuccess=function(){var original=button.title||'Copy code';button.title='Copied';button.setAttribute('aria-label','Copied');if(toast){toast.style.opacity='1';toast.style.transform='translateY(0)';clearTimeout(button.__owpCopyToastTimer);button.__owpCopyToastTimer=setTimeout(function(){toast.style.opacity='0';toast.style.transform='translateY(-4px)';},1200);}setTimeout(function(){button.title=original;button.setAttribute('aria-label',original);},1200);};",
    "if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(onSuccess).catch(function(){});return;}",
    "var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','readonly');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();try{document.execCommand('copy');onSuccess();}finally{document.body.removeChild(area);}",
    "})(this);"
  ].join("");
}
function normalizeTables(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("table").forEach((table) => {
    var _a, _b;
    if (!((_a = table.parentElement) == null ? void 0 : _a.classList.contains("owp-table-wrapper"))) {
      const wrapper = document.createElement("div");
      wrapper.className = "owp-table-wrapper";
      appendInlineStyle(wrapper, [
        "width:100%",
        "overflow-x:auto",
        "margin:1.25em 0",
        "border:1px solid rgba(0,0,0,0.12)",
        "border-radius:10px",
        "box-shadow:0 1px 2px rgba(0,0,0,0.04)"
      ]);
      (_b = table.parentNode) == null ? void 0 : _b.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
    table.classList.add("owp-table");
    appendInlineStyle(table, [
      "width:100%",
      "border-collapse:collapse",
      "border-spacing:0",
      "margin:0",
      "font-size:0.95em",
      "line-height:1.6"
    ]);
    table.querySelectorAll("th").forEach((cell) => {
      appendInlineStyle(cell, [
        "padding:0.75em 0.9em",
        "border:1px solid rgba(0,0,0,0.14)",
        "background:#f3f6f8",
        "color:#263238",
        "font-weight:700",
        "text-align:left",
        "vertical-align:top"
      ]);
    });
    table.querySelectorAll("td").forEach((cell) => {
      appendInlineStyle(cell, [
        "padding:0.75em 0.9em",
        "border:1px solid rgba(0,0,0,0.12)",
        "vertical-align:top"
      ]);
    });
    table.querySelectorAll("tbody tr:nth-child(even)").forEach((row) => {
      appendInlineStyle(row, ["background:rgba(0,0,0,0.025)"]);
    });
  });
  return container.innerHTML;
}
function normalizeRenderedImages(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("img").forEach((image) => {
    if (image.getAttribute("referrerpolicy") === "no-referrer") {
      image.removeAttribute("referrerpolicy");
    }
  });
  return container.innerHTML;
}
function normalizeAdmonitionCallouts(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll(".callout.admonition, .admonition").forEach((callout) => {
    const calloutType = getCalloutType(callout);
    const color = callout.style.getPropertyValue("--callout-color") || calloutColor(calloutType);
    callout.classList.add("owp-callout", `owp-callout-${calloutType}`);
    appendInlineStyle(callout, [
      "box-sizing:border-box",
      "margin:1.25em 0",
      "padding:0",
      "border:1px solid rgba(" + color + ",0.25)",
      "border-left:4px solid rgb(" + color + ")",
      "border-radius:8px",
      "background:rgba(" + color + ",0.06)",
      "overflow:hidden"
    ]);
    callout.querySelectorAll(".callout-title, .admonition-title").forEach((title) => {
      title.classList.add("owp-callout-title");
      appendInlineStyle(title, [
        "box-sizing:border-box",
        "display:flex",
        "align-items:center",
        "gap:0.5em",
        "padding:0.7em 0.9em",
        "font-weight:600",
        "line-height:1.35",
        "color:rgb(" + color + ")"
      ]);
    });
    callout.querySelectorAll(".callout-icon, .admonition-title-icon").forEach((icon) => {
      icon.classList.add("owp-callout-icon");
      appendInlineStyle(icon, [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:1.1em",
        "height:1.1em",
        "min-width:1.1em",
        "line-height:1",
        "flex:0 0 auto"
      ]);
    });
    callout.querySelectorAll(".callout-icon svg, .admonition-title-icon svg").forEach((svg) => {
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      appendInlineStyle(svg, [
        "display:block",
        "width:1em",
        "height:1em",
        "max-width:1em",
        "max-height:1em",
        "min-width:0",
        "min-height:0",
        "flex:0 0 auto"
      ]);
    });
    callout.querySelectorAll(".callout-content, .admonition-content").forEach((content) => {
      content.classList.add("owp-callout-content");
      appendInlineStyle(content, [
        "box-sizing:border-box",
        "padding:0.8em 0.9em",
        "line-height:1.65"
      ]);
    });
  });
  return container.innerHTML;
}
function getCalloutType(callout) {
  const dataCallout = callout.getAttribute("data-callout");
  if (dataCallout) return sanitizeClassName(dataCallout);
  for (const className of Array.from(callout.classList)) {
    const match = className.match(/^admonition-(.+)$/);
    if (match) return sanitizeClassName(match[1]);
  }
  return "note";
}
function calloutColor(type) {
  var _a;
  const colors = {
    tip: "0, 191, 165",
    hint: "0, 191, 165",
    note: "68, 138, 255",
    info: "0, 184, 212",
    warning: "255, 145, 0",
    caution: "255, 145, 0",
    danger: "255, 82, 82",
    error: "255, 82, 82",
    bug: "245, 0, 87",
    quote: "158, 158, 158"
  };
  return (_a = colors[type]) != null ? _a : colors.note;
}
function sanitizeClassName(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "note";
}
function appendInlineStyle(element, declarations) {
  var _a;
  const current = (_a = element.getAttribute("style")) == null ? void 0 : _a.trim();
  const suffix = declarations.join(";");
  element.setAttribute("style", current ? `${current};${suffix}` : suffix);
}
function renderPlaceholder(placeholder) {
  switch (placeholder.kind) {
    case "flowchart":
      return `<pre class="obsidian-flowchart flowchart">${escapeHtml(placeholder.value)}</pre>`;
    case "math-block":
      return `<div class="obsidian-math obsidian-math-block">\\[${escapeHtml(placeholder.value)}\\]</div>`;
    case "math-inline":
      return `<span class="obsidian-math obsidian-math-inline">\\(${escapeHtml(placeholder.value)}\\)</span>`;
  }
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/markdown-converter.ts
var ObsidianMarkdownConverter = class {
  constructor(app, logger) {
    this.app = app;
    this.logger = logger;
  }
  async toHtml(markdown, sourcePath) {
    this.logger.info("Rendering Obsidian Markdown to HTML", { sourcePath });
    const transformer = new ObsidianSpecialFormatTransformer(this.logger);
    const renderableMarkdown = transformer.beforeRender(markdown);
    const container = document.createElement("div");
    const component = new import_obsidian7.Component();
    try {
      await import_obsidian7.MarkdownRenderer.render(this.app, renderableMarkdown, container, sourcePath, component);
      return transformer.afterRender(container.innerHTML);
    } finally {
      component.unload();
    }
  }
};

// src/metadata-modal.ts
var import_obsidian8 = require("obsidian");
var MetadataModal = class extends import_obsidian8.Modal {
  constructor(app, defaults, onSubmit, categoryActions) {
    var _a;
    super(app);
    this.onSubmit = onSubmit;
    this.categoryActions = categoryActions;
    this.slug = "";
    this.excerpt = "";
    this.tags = "";
    this.selectedCategoryNames = /* @__PURE__ */ new Set();
    this.newCategoryName = "";
    this.newCategoryParentId = 0;
    this.title = defaults.title;
    this.status = defaults.status;
    this.categories = (_a = categoryActions == null ? void 0 : categoryActions.categories) != null ? _a : [];
  }
  onOpen() {
    this.render();
  }
  onClose() {
    this.contentEl.empty();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Publish to WordPress" });
    contentEl.createEl("p", {
      text: "This note has no WordPress mapping yet. Fill the fields below; they will be saved to the note frontmatter."
    });
    new import_obsidian8.Setting(contentEl).setName("Title").setDesc("Required. WordPress post title.").addText((text) => text.setValue(this.title).onChange((value) => {
      this.title = value;
    }));
    new import_obsidian8.Setting(contentEl).setName("Slug").setDesc("Optional. Leave blank to let WordPress generate it.").addText((text) => text.setPlaceholder("my-post-slug").setValue(this.slug).onChange((value) => {
      this.slug = value;
    }));
    new import_obsidian8.Setting(contentEl).setName("Status").setDesc("Required. Draft is safest for the first publish.").addDropdown((dropdown) => dropdown.addOption("draft", "Draft").addOption("publish", "Publish").addOption("private", "Private").addOption("pending", "Pending").setValue(this.status).onChange((value) => {
      this.status = value;
    }));
    new import_obsidian8.Setting(contentEl).setName("Excerpt").setDesc("Optional.").addTextArea((text) => text.setValue(this.excerpt).onChange((value) => {
      this.excerpt = value;
    }));
    this.renderCategorySelector(contentEl);
    new import_obsidian8.Setting(contentEl).setName("Tags").setDesc("Optional comma-separated tag names. Missing terms will be created.").addText((text) => text.setPlaceholder("obsidian, wordpress").setValue(this.tags).onChange((value) => {
      this.tags = value;
    }));
    new import_obsidian8.Setting(contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.close())).addButton((button) => button.setCta().setButtonText("Save and publish").onClick(() => {
      const title = this.title.trim();
      if (!title) {
        this.contentEl.createEl("p", { text: "Title is required.", cls: "mod-warning" });
        return;
      }
      this.onSubmit({
        title,
        slug: emptyToUndefined2(this.slug),
        status: this.status,
        excerpt: emptyToUndefined2(this.excerpt),
        categories: Array.from(this.selectedCategoryNames),
        tags: splitCsv(this.tags)
      });
      this.close();
    }));
  }
  renderCategorySelector(contentEl) {
    contentEl.createEl("h3", { text: "Categories" });
    contentEl.createEl("p", {
      text: this.categoryActions ? "Select WordPress categories. You can add or delete categories directly here." : "WordPress categories could not be loaded; publish will continue without categories."
    });
    if (!this.categoryActions) return;
    new import_obsidian8.Setting(contentEl).setName("Add category").addText((text) => text.setPlaceholder("New category name").setValue(this.newCategoryName).onChange((value) => {
      this.newCategoryName = value;
    })).addDropdown((dropdown) => {
      dropdown.addOption("0", "No parent");
      flattenCategoryTree(this.categories).forEach(({ category, depth }) => {
        dropdown.addOption(String(category.id), `${"  ".repeat(depth)}${depth > 0 ? "- " : ""}${category.name}`);
      });
      dropdown.setValue(String(this.newCategoryParentId));
      dropdown.onChange((value) => {
        this.newCategoryParentId = Number(value) || 0;
      });
    }).addButton((button) => button.setButtonText("Add").onClick(async () => {
      var _a;
      const name = this.newCategoryName.trim();
      if (!name) return;
      const created = await ((_a = this.categoryActions) == null ? void 0 : _a.create(name, this.newCategoryParentId || void 0));
      if (created) {
        this.selectedCategoryNames.add(created.name);
        this.newCategoryName = "";
        this.newCategoryParentId = 0;
        this.categories = await this.categoryActions.refresh();
        this.render();
      }
    })).addButton((button) => button.setButtonText("Refresh").onClick(async () => {
      this.categories = await this.categoryActions.refresh();
      this.render();
    }));
    if (this.categories.length === 0) {
      contentEl.createEl("p", { text: "No categories found." });
      return;
    }
    flattenCategoryTree(this.categories).forEach(({ category, depth }) => {
      new import_obsidian8.Setting(contentEl).setName(`${"  ".repeat(depth)}${depth > 0 ? "- " : ""}${category.name}`).setDesc(`slug: ${category.slug}`).addToggle((toggle) => toggle.setValue(this.selectedCategoryNames.has(category.name)).onChange((value) => {
        if (value) this.selectedCategoryNames.add(category.name);
        else this.selectedCategoryNames.delete(category.name);
      })).addButton((button) => button.setWarning().setButtonText("Delete").onClick(async () => {
        await this.categoryActions.delete(category.id);
        this.selectedCategoryNames.delete(category.name);
        this.categories = await this.categoryActions.refresh();
        this.render();
      }));
    });
  }
};
function splitCsv(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
function flattenCategoryTree(categories) {
  const byParent = /* @__PURE__ */ new Map();
  const byId = new Map(categories.map((category) => [category.id, category]));
  categories.forEach((category) => {
    var _a;
    const parent = category.parent && byId.has(category.parent) ? category.parent : 0;
    const siblings = (_a = byParent.get(parent)) != null ? _a : [];
    siblings.push(category);
    byParent.set(parent, siblings);
  });
  byParent.forEach((siblings) => siblings.sort((left, right) => left.name.localeCompare(right.name)));
  const output = [];
  const visited = /* @__PURE__ */ new Set();
  const visit = (parent, depth) => {
    var _a;
    for (const category of (_a = byParent.get(parent)) != null ? _a : []) {
      if (visited.has(category.id)) continue;
      visited.add(category.id);
      output.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(0, 0);
  categories.forEach((category) => {
    if (!visited.has(category.id)) output.push({ category, depth: 0 });
  });
  return output;
}
function emptyToUndefined2(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// src/remote-post-modals.ts
var import_obsidian9 = require("obsidian");
function confirmRemoteOverwrite(app, remote, localUpdatedAt) {
  return new Promise((resolve) => {
    new RemoteConflictModal(app, remote, localUpdatedAt, resolve).open();
  });
}
function confirmRemoteDelete(app, remote) {
  return new Promise((resolve) => {
    new RemoteDeleteModal(app, remote, resolve).open();
  });
}
var RemoteStatusModal = class extends import_obsidian9.Modal {
  constructor(app, remote) {
    super(app);
    this.remote = remote;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "WordPress remote post status" });
    renderPostSummary(contentEl, this.remote);
    new import_obsidian9.Setting(contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var RemoteConflictModal = class extends import_obsidian9.Modal {
  constructor(app, remote, localUpdatedAt, resolve) {
    super(app);
    this.remote = remote;
    this.localUpdatedAt = localUpdatedAt;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Remote post changed" });
    contentEl.createEl("p", {
      text: "The WordPress post appears to have been modified after the last successful publish from Obsidian."
    });
    renderPostSummary(contentEl, this.remote, this.localUpdatedAt);
    new import_obsidian9.Setting(contentEl).addButton((button) => button.setButtonText("Cancel publish").onClick(() => this.finish("cancel"))).addButton((button) => button.setWarning().setButtonText("Overwrite remote").onClick(() => this.finish("overwrite")));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.finish("cancel");
  }
  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
};
var RemoteDeleteModal = class extends import_obsidian9.Modal {
  constructor(app, remote, resolve) {
    super(app);
    this.remote = remote;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Remove WordPress post" });
    contentEl.createEl("p", { text: "Choose how to remove the remote WordPress post." });
    renderPostSummary(contentEl, this.remote);
    new import_obsidian9.Setting(contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish("cancel"))).addButton((button) => button.setButtonText("Move to trash").onClick(() => this.finish("trash"))).addButton((button) => button.setWarning().setButtonText("Delete permanently").onClick(() => this.finish("delete")));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.finish("cancel");
  }
  finish(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
};
function renderPostSummary(container, remote, localUpdatedAt) {
  const list = container.createEl("dl");
  addRow(list, "ID", String(remote.id));
  addRow(list, "Status", remote.status);
  addRow(list, "URL", remote.link);
  addRow(list, "Published", remote.date);
  addRow(list, "Remote modified", remote.modified);
  if (localUpdatedAt) addRow(list, "Local last publish", localUpdatedAt);
}
function addRow(list, label, value) {
  list.createEl("dt", { text: label });
  list.createEl("dd", { text: value || "(empty)" });
}

// src/publisher.ts
var PublishService = class {
  constructor(app, settings, logger, mediaCacheStore, persistSettings = async () => void 0) {
    this.app = app;
    this.settings = settings;
    this.logger = logger;
    this.mediaCacheStore = mediaCacheStore;
    this.persistSettings = persistSettings;
    this.frontmatter = new FrontmatterService(app);
  }
  async publishCurrentNote(options = {}) {
    this.assertSettingsReady();
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active note. Open a Markdown note before publishing.");
    }
    if (file.extension !== "md") {
      throw new Error("The active file is not a Markdown note.");
    }
    return this.publishFile(file, options);
  }
  async publishNoteByPath(path, options = {}) {
    this.assertSettingsReady();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian10.TFile)) {
      throw new Error(`Markdown note not found: ${path}`);
    }
    if (file.extension !== "md") {
      throw new Error("The requested file is not a Markdown note.");
    }
    if (options.openBeforePublish) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
    return this.publishFile(file, options);
  }
  async publishFile(file, options) {
    const metadata = this.frontmatter.read(file);
    if (!this.frontmatter.hasRequiredMapping(metadata)) {
      if (options.allowInteractive === false) {
        throw new Error("Missing required WordPress frontmatter: wp_title and wp_status are required. Enable interactive mode or add the fields before publishing.");
      }
      await this.collectInitialMetadata(file);
      return void 0;
    }
    return this.publishWithExistingMapping(file, options);
  }
  async collectInitialMetadata(file) {
    const defaultTitle = file.basename;
    const categoryActions = await this.createCategoryActions();
    new MetadataModal(
      this.app,
      { title: defaultTitle, status: this.settings.defaultStatus },
      async (input) => {
        try {
          this.logger.info("Saving initial WordPress frontmatter mapping", input);
          await this.frontmatter.writeInitialMapping(file, input);
          await this.publish(file, input);
        } catch (error) {
          this.logger.error("Initial publish failed", serializeError6(error));
          showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
        }
      },
      categoryActions
    ).open();
  }
  async createCategoryActions() {
    try {
      const client = new WordPressClient(this.settings, this.logger);
      const categories = await client.getCategories();
      return {
        categories,
        refresh: () => client.getCategories(),
        create: (name, parent) => client.createCategory(name, parent),
        delete: async (categoryId) => {
          await client.deleteCategory(categoryId);
        }
      };
    } catch (error) {
      this.logger.warn("Could not load WordPress categories for publish modal", serializeError6(error));
      return void 0;
    }
  }
  async publishWithExistingMapping(file, options) {
    const metadata = this.frontmatter.read(file);
    const input = this.frontmatter.buildInputFromFrontmatter(metadata);
    if (options.status) input.status = options.status;
    return this.publish(file, input, options);
  }
  async publish(file, input, options = {}) {
    const rawContent = await this.app.vault.read(file);
    const markdownBody = stripFrontmatter(rawContent);
    const metadata = this.frontmatter.read(file);
    const client = new WordPressClient(this.settings, this.logger);
    await this.ensureRemoteCanBeOverwritten(client, metadata.wp_post_id, metadata.wp_updated_at, options);
    const imageProcessor = new WordPressImageAssetProcessor(
      this.app,
      client,
      this.settings,
      this.logger,
      this.mediaCacheStore,
      this.persistSettings
    );
    const markdownWithRemoteImages = await imageProcessor.rewriteMarkdownImages(markdownBody, file.path, input.title);
    const converter = new ObsidianMarkdownConverter(this.app, this.logger);
    const htmlBody = await converter.toHtml(markdownWithRemoteImages, file.path);
    this.logger.info("Preparing WordPress payload", { file: file.path, metadata: input });
    const [categoryIds, tagIds] = await Promise.all([
      client.resolveTerms("categories", input.categories),
      client.resolveTerms("tags", input.tags)
    ]);
    const payload = {
      title: input.title,
      content: htmlBody,
      status: input.status,
      slug: input.slug,
      excerpt: input.excerpt,
      categories: categoryIds.length > 0 ? categoryIds : void 0,
      tags: tagIds.length > 0 ? tagIds : void 0
    };
    const response = await client.createOrUpdatePost(metadata.wp_post_id, payload);
    await this.frontmatter.writePublishResult(file, response);
    if (options.showNotice !== false) {
      new import_obsidian10.Notice(`Published to WordPress: ${response.link}`, 8e3);
    }
    this.logger.info("Publish completed", response);
    return {
      postId: response.id,
      url: response.link,
      status: response.status,
      notePath: file.path,
      created: !metadata.wp_post_id,
      updated: Boolean(metadata.wp_post_id),
      publishedAt: response.date,
      modifiedAt: response.modified
    };
  }
  async ensureRemoteCanBeOverwritten(client, postId, localUpdatedAt, options) {
    if (!postId || !localUpdatedAt) return;
    const remote = await client.getPost(postId);
    this.logger.info("Checked remote post before overwrite", { postId, localUpdatedAt, remoteModified: remote.modified });
    if (sameTimestamp(remote.modified, localUpdatedAt)) return;
    if (options.overwriteRemoteChanges) {
      this.logger.warn("Overwriting remotely modified WordPress post because overwriteRemoteChanges is enabled", { postId });
      return;
    }
    if (options.allowInteractive === false) {
      throw new Error("Remote WordPress post has changed since the last publish. Set overwriteRemoteChanges=true to overwrite it.");
    }
    const decision = await confirmRemoteOverwrite(this.app, remote, localUpdatedAt);
    if (decision !== "overwrite") {
      throw new Error("Publish canceled because the remote WordPress post has changed.");
    }
  }
  assertSettingsReady() {
    const missing = [];
    if (!this.settings.siteUrl) missing.push("site URL");
    if (!this.settings.username) missing.push("username");
    if (!this.settings.applicationPassword) missing.push("application password");
    if (missing.length > 0) {
      throw new Error(`WordPress settings incomplete: ${missing.join(", ")}.`);
    }
  }
};
function serializeError6(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
function sameTimestamp(left, right) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return Math.abs(leftTime - rightTime) < 1e3;
  }
  return left === right;
}

// src/remote-post-service.ts
var import_obsidian11 = require("obsidian");
var RemotePostService = class {
  constructor(app, settings, logger) {
    this.app = app;
    this.settings = settings;
    this.logger = logger;
    this.frontmatter = new FrontmatterService(app);
  }
  async showCurrentRemoteStatus() {
    const { remote } = await this.getRemoteStatus();
    new RemoteStatusModal(this.app, remote).open();
  }
  async unpublishCurrentPost() {
    const { response } = await this.unpublishPost();
    new import_obsidian11.Notice(`Moved WordPress post to draft: ${response.link}`, 8e3);
  }
  async deleteCurrentRemotePost() {
    const { file, postId } = this.getActiveMappedPost();
    const client = new WordPressClient(this.settings, this.logger);
    const remote = await client.getPost(postId);
    const decision = await confirmRemoteDelete(this.app, remote);
    if (decision === "cancel") {
      this.logger.info("Remote post deletion canceled", { postId });
      return;
    }
    const result = await client.deletePost(postId, decision === "delete");
    await this.frontmatter.clearWordPressMapping(file);
    this.logger.info("Removed remote WordPress post", { decision, result });
    new import_obsidian11.Notice(decision === "delete" ? "WordPress post deleted permanently." : "WordPress post moved to trash.", 8e3);
  }
  async getRemoteStatus(path) {
    const { file, postId } = this.getMappedPost(path);
    const client = new WordPressClient(this.settings, this.logger);
    const remote = await client.getPost(postId);
    this.logger.info("Fetched remote WordPress post status", { file: file.path, remote });
    return { file, remote };
  }
  async unpublishPost(path) {
    const { file, postId } = this.getMappedPost(path);
    const client = new WordPressClient(this.settings, this.logger);
    const response = await client.updatePostStatus(postId, "draft");
    await this.frontmatter.writePublishResult(file, response);
    this.logger.info("Unpublished remote WordPress post", { file: file.path, response });
    return { file, response };
  }
  async deleteRemotePost(path, force) {
    const { file, postId } = this.getMappedPost(path);
    const client = new WordPressClient(this.settings, this.logger);
    const result = await client.deletePost(postId, force);
    await this.frontmatter.clearWordPressMapping(file);
    this.logger.info("Removed remote WordPress post via API", { file: file.path, force, result });
    return { file, result };
  }
  getActiveMappedPost() {
    return this.getMappedPost();
  }
  getMappedPost(path) {
    if (path) {
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (!(abstractFile instanceof import_obsidian11.TFile)) throw new Error(`Markdown note not found: ${path}`);
      if (abstractFile.extension !== "md") throw new Error("The requested file is not a Markdown note.");
      return this.requirePostId(abstractFile);
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new Error("No active note. Open a published Markdown note first.");
    if (file.extension !== "md") throw new Error("The active file is not a Markdown note.");
    return this.requirePostId(file);
  }
  requirePostId(file) {
    const metadata = this.frontmatter.read(file);
    if (!metadata.wp_post_id) {
      throw new Error("This note does not have wp_post_id in frontmatter. Publish it before using remote post actions.");
    }
    return { file, postId: metadata.wp_post_id };
  }
};

// src/secret-store.ts
var ElectronSafeStorageSecretStore = class {
  constructor(data, logger) {
    this.data = data;
    this.logger = logger;
    this.backend = "unavailable";
    this.available = false;
    this.secure = false;
    var _a, _b, _c, _d;
    this.safeStorage = loadSafeStorage(logger);
    this.available = Boolean((_a = this.safeStorage) == null ? void 0 : _a.isEncryptionAvailable());
    this.backend = (_d = (_c = (_b = this.safeStorage) == null ? void 0 : _b.getSelectedStorageBackend) == null ? void 0 : _c.call(_b)) != null ? _d : this.available ? "os_crypt" : "unavailable";
    this.secure = this.available && this.backend !== "basic_text";
  }
  status() {
    return {
      available: this.available,
      secure: this.secure,
      backend: this.backend,
      warning: this.warning()
    };
  }
  async get(key) {
    const encrypted = this.data[key];
    if (!encrypted || !this.safeStorage || !this.available) return void 0;
    try {
      return this.safeStorage.decryptString(base64ToBuffer(encrypted));
    } catch (error) {
      this.logger.warn("Failed to decrypt secret", { key, error: serializeError7(error) });
      return void 0;
    }
  }
  async set(key, value) {
    if (!this.safeStorage || !this.available) {
      throw new Error("Secure secret storage is unavailable on this system.");
    }
    const encrypted = this.safeStorage.encryptString(value);
    this.data[key] = bufferToBase64(encrypted);
  }
  async delete(key) {
    delete this.data[key];
  }
  warning() {
    if (!this.available) return "Electron safeStorage encryption is unavailable. Sensitive settings cannot be saved securely.";
    if (this.backend === "basic_text") return "Electron safeStorage is using Linux basic_text backend. This is weak protection and should not be used for long-lived secrets.";
    return void 0;
  }
};
function loadSafeStorage(logger) {
  var _a, _b;
  try {
    if (typeof require !== "function") return void 0;
    const electron = require("electron");
    return (_b = electron.safeStorage) != null ? _b : (_a = electron.remote) == null ? void 0 : _a.safeStorage;
  } catch (error) {
    logger.warn("Could not load Electron safeStorage", serializeError7(error));
    return void 0;
  }
}
function bufferToBase64(buffer) {
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
function serializeError7(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

// src/settings.ts
var import_obsidian12 = require("obsidian");
var DEFAULT_SETTINGS = {
  siteUrl: "",
  username: "",
  applicationPassword: "",
  applicationPasswordSaved: false,
  defaultStatus: "draft",
  debug: false,
  imageCompressionQuality: 0.82,
  largeImageThresholdMb: 2,
  imageStorageProvider: "wordpress",
  aliyunOss: {
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    accessKeySecret: "",
    accessKeySecretSaved: false,
    publicBaseUrl: "",
    objectKeyRule: "obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}",
    testReferer: ""
  },
  localApi: {
    enabled: false,
    port: 27187,
    apiKeySaved: false,
    apiKeySalt: "",
    apiKeyHash: "",
    allowInteractive: false,
    allowDestructiveActions: false
  },
  encryptedSecrets: {},
  mediaCache: {}
};
var WordPressSettingTab = class extends import_obsidian12.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    let applicationPasswordInput = "";
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian to WordPress" });
    const secretStatus = this.plugin.settings.secretStoreStatus;
    if (secretStatus) {
      containerEl.createEl("p", {
        text: secretStatus.warning ? `Secret storage warning: ${secretStatus.warning}` : `Secret storage: ${secretStatus.backend} (${secretStatus.secure ? "secure" : "not secure"})`
      });
    }
    new import_obsidian12.Setting(containerEl).setName("WordPress site URL").setDesc("Self-hosted WordPress base URL, for example https://example.com").addText((text) => text.setPlaceholder("https://example.com").setValue(this.plugin.settings.siteUrl).onChange(async (value) => {
      this.plugin.settings.siteUrl = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("Username").setDesc("WordPress username used with an Application Password.").addText((text) => text.setPlaceholder("wordpress-user").setValue(this.plugin.settings.username).onChange(async (value) => {
      this.plugin.settings.username = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("Application Password").setDesc(this.plugin.settings.applicationPasswordSaved ? "Saved encrypted with Electron safeStorage. Enter a new value to replace it." : "WordPress Application Password. Saved encrypted with Electron safeStorage.").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("xxxx xxxx xxxx xxxx xxxx xxxx").onChange(async (value) => {
        applicationPasswordInput = value;
      });
    }).addButton((button) => button.setCta().setButtonText("Save").onClick(async () => {
      await this.plugin.setSecret("wordpress.applicationPassword", applicationPasswordInput);
      this.display();
    })).addButton((button) => button.setButtonText("Clear").onClick(async () => {
      await this.plugin.deleteSecret("wordpress.applicationPassword");
      this.display();
    }));
    new import_obsidian12.Setting(containerEl).setName("Default post status").setDesc("Used when a note does not already contain WordPress frontmatter.").addDropdown((dropdown) => dropdown.addOption("draft", "Draft").addOption("publish", "Publish").addOption("private", "Private").addOption("pending", "Pending").setValue(this.plugin.settings.defaultStatus).onChange(async (value) => {
      this.plugin.settings.defaultStatus = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "Image upload" });
    new import_obsidian12.Setting(containerEl).setName("Image storage provider").setDesc("Choose where local images are uploaded before their URLs are inserted into WordPress posts.").addDropdown((dropdown) => dropdown.addOption("wordpress", "WordPress Media Library").addOption("aliyun-oss", "Aliyun OSS").setValue(this.plugin.settings.imageStorageProvider).onChange(async (value) => {
      this.plugin.settings.imageStorageProvider = value;
      await this.plugin.saveSettings();
      this.display();
    }));
    new import_obsidian12.Setting(containerEl).setName("Image compression quality").setDesc("JPEG/WebP compression quality from 0.1 to 1. PNG images without transparency may be converted to JPEG.").addSlider((slider) => slider.setLimits(0.1, 1, 0.01).setDynamicTooltip().setValue(this.plugin.settings.imageCompressionQuality).onChange(async (value) => {
      this.plugin.settings.imageCompressionQuality = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("Large image threshold").setDesc("Ask before uploading an image if the prepared upload size exceeds this threshold in MB. Set 0 to disable the warning.").addText((text) => text.setPlaceholder("2").setValue(String(this.plugin.settings.largeImageThresholdMb)).onChange(async (value) => {
      const parsed = Number(value);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        this.plugin.settings.largeImageThresholdMb = parsed;
        await this.plugin.saveSettings();
      }
    }));
    if (this.plugin.settings.imageStorageProvider === "aliyun-oss") {
      this.displayAliyunOssSettings(containerEl);
    }
    this.displayLocalApiSettings(containerEl);
    this.displayDebugSettings(containerEl);
  }
  displayDebugSettings(containerEl) {
    containerEl.createEl("h3", { text: "Debug" });
    const pluginLogPath = this.plugin.getPluginLogPath();
    const mcpLogPath = "/tmp/obsidian-to-wordpress-mcp.log";
    const debugSetting = new import_obsidian12.Setting(containerEl).setName("Debug mode").setDesc("When enabled, write detailed plugin and MCP logs to files. Obsidian only shows error logs when an operation fails.").addToggle((toggle) => toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
      this.plugin.settings.debug = value;
      await this.plugin.saveSettings();
      this.display();
    }));
    if (this.plugin.settings.debug) {
      debugSetting.addButton((button) => button.setButtonText("Copy log paths").onClick(async () => {
        const value = [
          `Plugin log: ${pluginLogPath || "(unavailable in this Obsidian adapter)"}`,
          `MCP log: ${mcpLogPath}`
        ].join("\n");
        await navigator.clipboard.writeText(value);
        new import_obsidian12.Notice("Log paths copied", 4e3);
      }));
    }
    markWarningSetting(debugSetting);
  }
  displayLocalApiSettings(containerEl) {
    containerEl.createEl("h3", { text: "Local API / MCP" });
    containerEl.createEl("p", {
      text: `Status: ${this.plugin.localApiStatus()}. The local API listens on 127.0.0.1 only and is intended for MCP clients such as Codex.`
    });
    const enableApiSetting = new import_obsidian12.Setting(containerEl).setName("Enable local API").setDesc("Allow a local MCP bridge to ask this Obsidian plugin to publish notes. Requires an API key.").addToggle((toggle) => toggle.setValue(this.plugin.settings.localApi.enabled).onChange(async (value) => {
      if (value) {
        const confirmed = await confirmDangerousSetting(
          this.app,
          "Enable local API?",
          "This opens a localhost API that can publish notes through this Obsidian plugin when the caller has your API key."
        );
        if (!confirmed) {
          toggle.setValue(false);
          return;
        }
      }
      this.plugin.settings.localApi.enabled = value;
      await this.plugin.saveSettings();
      await this.plugin.restartLocalApiServer();
      this.display();
    }));
    markDangerSetting(enableApiSetting);
    new import_obsidian12.Setting(containerEl).setName("API port").setDesc("Localhost port used by the Obsidian plugin API. Default: 27187.").addText((text) => text.setPlaceholder("27187").setValue(String(this.plugin.settings.localApi.port)).onChange(async (value) => {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        this.plugin.settings.localApi.port = parsed;
        await this.plugin.saveSettings();
        await this.plugin.restartLocalApiServer();
      }
    }));
    new import_obsidian12.Setting(containerEl).setName("API key").setDesc(this.plugin.settings.localApi.apiKeySaved ? "An API key exists. It is never shown again. Generate a new key if you forgot it; the old key will stop working." : "No API key exists. Generate one before connecting an MCP client.").addButton((button) => button.setCta().setButtonText(this.plugin.settings.localApi.apiKeySaved ? "Regenerate" : "Generate").onClick(async () => {
      const token = await this.plugin.generateLocalApiKey();
      new ApiKeyModal(this.app, token).open();
      await this.plugin.restartLocalApiServer();
      this.display();
    }));
    const interactiveSetting = new import_obsidian12.Setting(containerEl).setName("Allow interactive Obsidian modals from API").setDesc("If enabled, API calls may open Obsidian modals for missing metadata or confirmations. Disabled is safer for automation.").addToggle((toggle) => toggle.setValue(this.plugin.settings.localApi.allowInteractive).onChange(async (value) => {
      if (value) {
        const confirmed = await confirmDangerousSetting(
          this.app,
          "Allow API-triggered Obsidian modals?",
          "MCP/API calls may open publish dialogs, overwrite confirmations, and large upload confirmations in Obsidian. This can cause automation to wait for your manual action."
        );
        if (!confirmed) {
          toggle.setValue(false);
          return;
        }
      }
      this.plugin.settings.localApi.allowInteractive = value;
      await this.plugin.saveSettings();
    }));
    markDangerSetting(interactiveSetting);
    const destructiveSetting = new import_obsidian12.Setting(containerEl).setName("Allow destructive API actions").setDesc("Reserved for future delete/unpublish MCP tools. Keep disabled unless you explicitly need remote deletion from MCP.").addToggle((toggle) => toggle.setValue(this.plugin.settings.localApi.allowDestructiveActions).onChange(async (value) => {
      if (value) {
        const confirmed = await confirmDangerousSetting(
          this.app,
          "Allow destructive API actions?",
          "Future MCP/API tools may be allowed to unpublish or delete remote WordPress posts. Only enable this if you understand the risk."
        );
        if (!confirmed) {
          toggle.setValue(false);
          return;
        }
      }
      this.plugin.settings.localApi.allowDestructiveActions = value;
      await this.plugin.saveSettings();
    }));
    markDangerSetting(destructiveSetting);
  }
  displayAliyunOssSettings(containerEl) {
    let accessKeySecretInput = "";
    containerEl.createEl("h3", { text: "Aliyun OSS" });
    new import_obsidian12.Setting(containerEl).setName("OSS endpoint").setDesc("Example: https://oss-cn-hangzhou.aliyuncs.com or https://bucket.oss-cn-hangzhou.aliyuncs.com").addText((text) => text.setPlaceholder("https://oss-cn-hangzhou.aliyuncs.com").setValue(this.plugin.settings.aliyunOss.endpoint).onChange(async (value) => {
      this.plugin.settings.aliyunOss.endpoint = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("OSS bucket").setDesc("Bucket name. If your endpoint already includes the bucket, this is still used for request signing.").addText((text) => text.setPlaceholder("my-bucket").setValue(this.plugin.settings.aliyunOss.bucket).onChange(async (value) => {
      this.plugin.settings.aliyunOss.bucket = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("AccessKey ID").setDesc("Aliyun AccessKey ID with permission to put objects into the bucket.").addText((text) => text.setValue(this.plugin.settings.aliyunOss.accessKeyId).onChange(async (value) => {
      this.plugin.settings.aliyunOss.accessKeyId = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("AccessKey Secret").setDesc(this.plugin.settings.aliyunOss.accessKeySecretSaved ? "Saved encrypted with Electron safeStorage. Enter a new value to replace it." : "Aliyun AccessKey Secret. Saved encrypted with Electron safeStorage.").addText((text) => {
      text.inputEl.type = "password";
      text.onChange(async (value) => {
        accessKeySecretInput = value;
      });
    }).addButton((button) => button.setCta().setButtonText("Save").onClick(async () => {
      await this.plugin.setSecret("aliyun.accessKeySecret", accessKeySecretInput);
      this.display();
    })).addButton((button) => button.setButtonText("Clear").onClick(async () => {
      await this.plugin.deleteSecret("aliyun.accessKeySecret");
      this.display();
    }));
    new import_obsidian12.Setting(containerEl).setName("Public base URL").setDesc("The URL prefix inserted into posts. Usually your CDN domain or OSS public endpoint, for example https://img.example.com").addText((text) => text.setPlaceholder("https://img.example.com").setValue(this.plugin.settings.aliyunOss.publicBaseUrl).onChange(async (value) => {
      this.plugin.settings.aliyunOss.publicBaseUrl = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("OSS object key rule").setDesc("Available tokens: {postTitle}, {fileName}, {fileBaseName}, {ext}, {yyyy}, {mm}, {dd}, {hash}. Example: {postTitle}/{fileName}").addText((text) => text.setPlaceholder("{postTitle}/{fileName}").setValue(this.plugin.settings.aliyunOss.objectKeyRule).onChange(async (value) => {
      this.plugin.settings.aliyunOss.objectKeyRule = value.trim() || DEFAULT_SETTINGS.aliyunOss.objectKeyRule;
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("Test Referer").setDesc("Optional. Use your blog URL when OSS hotlink protection only allows your blog domain, for example https://blog.example.com/").addText((text) => text.setPlaceholder("https://blog.example.com/").setValue(this.plugin.settings.aliyunOss.testReferer).onChange(async (value) => {
      this.plugin.settings.aliyunOss.testReferer = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian12.Setting(containerEl).setName("Upload OSS test image").setDesc("Uploads a tiny generated PNG and checks whether its public URL can be reached. If hotlink protection is enabled, configure Test Referer first.").addButton((button) => button.setButtonText("Upload test image").onClick(async () => {
      await this.runOssUploadTest();
    }));
  }
  async runOssUploadTest() {
    const logger = new PublishLogger({
      debug: this.plugin.settings.debug,
      logPath: this.plugin.getPluginLogPath()
    });
    try {
      const settings = await this.plugin.settingsWithSecrets();
      const provider = createImageStorageProvider(settings, void 0, logger);
      const result = await provider.uploadImage(createTestImageUploadInput(settings.aliyunOss.objectKeyRule));
      logger.info("OSS test upload completed", result);
      const checker = new HttpMediaUrlChecker(logger);
      const status = await checker.check(result.url, settings.aliyunOss.testReferer || void 0);
      logger.info("OSS test URL check completed", { url: result.url, status, referer: settings.aliyunOss.testReferer });
      new import_obsidian12.Notice(`OSS test upload ${status === "missing" ? "uploaded but URL is not accessible" : "completed"}: ${result.url}`, 12e3);
      if (status !== "available") {
        logger.error("OSS test upload URL is not accessible", { url: result.url, status });
        showErrorLogModal(this.app, "OSS test upload failed", logger);
      }
    } catch (error) {
      if (error instanceof AliyunOssEndpointMismatchError) {
        logger.warn("OSS endpoint mismatch detected", {
          currentEndpoint: error.currentEndpoint,
          recommendedEndpoint: error.recommendedEndpoint
        });
        const shouldSwitch = await confirmEndpointSwitch(this.app, error.currentEndpoint, error.recommendedEndpoint);
        if (shouldSwitch) {
          this.plugin.settings.aliyunOss.endpoint = error.recommendedEndpoint;
          await this.plugin.saveSettings();
          new import_obsidian12.Notice(`OSS endpoint updated to ${error.recommendedEndpoint}. Please run the test again.`, 1e4);
          this.display();
        } else {
          new import_obsidian12.Notice(error.message, 1e4);
        }
        showErrorLogModal(this.app, "OSS test upload failed", logger, error);
        return;
      }
      logger.error("OSS test upload failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
      showErrorLogModal(this.app, "OSS test upload failed", logger, error);
    }
  }
};
var ApiKeyModal = class extends import_obsidian12.Modal {
  constructor(app, token) {
    super(app);
    this.token = token;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Local API key" });
    contentEl.createEl("p", {
      text: "Copy this API key now. It will not be shown again. If you lose it, generate a new key and the old key will be invalidated."
    });
    new import_obsidian12.Setting(contentEl).setName("API key").addText((text) => {
      text.setValue(this.token);
      text.inputEl.readOnly = true;
      text.inputEl.select();
    });
    new import_obsidian12.Setting(contentEl).addButton((button) => button.setCta().setButtonText("Copy").onClick(async () => {
      await navigator.clipboard.writeText(this.token);
      new import_obsidian12.Notice("API key copied", 4e3);
    })).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }
};
function markDangerSetting(setting) {
  setting.settingEl.style.borderLeft = "3px solid var(--text-error)";
  setting.settingEl.style.paddingLeft = "12px";
  setting.nameEl.style.color = "var(--text-error)";
  setting.descEl.style.color = "var(--text-error)";
}
function markWarningSetting(setting) {
  setting.settingEl.style.borderLeft = "3px solid var(--text-warning)";
  setting.settingEl.style.paddingLeft = "12px";
  setting.nameEl.style.color = "var(--text-warning)";
  setting.descEl.style.color = "var(--text-warning)";
}
function confirmDangerousSetting(app, title, message) {
  return new Promise((resolve) => {
    new DangerousSettingConfirmModal(app, title, message, resolve).open();
  });
}
var DangerousSettingConfirmModal = class extends import_obsidian12.Modal {
  constructor(app, title, message, resolve) {
    super(app);
    this.title = title;
    this.message = message;
    this.resolve = resolve;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title }).style.color = "var(--text-error)";
    contentEl.createEl("p", { text: this.message });
    contentEl.createEl("p", {
      text: "Confirm only if you trust the local MCP client and understand what this setting allows."
    });
    new import_obsidian12.Setting(contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false))).addButton((button) => {
      button.setWarning().setButtonText("Enable").onClick(() => this.finish(true));
    });
  }
  onClose() {
    this.resolve(false);
  }
  finish(confirmed) {
    const resolve = this.resolve;
    this.resolve = () => void 0;
    resolve(confirmed);
    this.close();
  }
};

// src/status-modal.ts
var import_obsidian13 = require("obsidian");
function choosePostStatus(app, currentStatus) {
  return new Promise((resolve) => {
    new PostStatusModal(app, currentStatus, resolve).open();
  });
}
var PostStatusModal = class extends import_obsidian13.Modal {
  constructor(app, currentStatus, resolve) {
    super(app);
    this.resolve = resolve;
    this.resolved = false;
    this.selectedStatus = currentStatus;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "WordPress publish status" });
    contentEl.createEl("p", { text: "Choose the status that should be used on the next publish." });
    new import_obsidian13.Setting(contentEl).setName("Status").addDropdown((dropdown) => dropdown.addOption("draft", "Draft").addOption("publish", "Publish").addOption("private", "Private").addOption("pending", "Pending").setValue(this.selectedStatus).onChange((value) => {
      this.selectedStatus = value;
    }));
    new import_obsidian13.Setting(contentEl).addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(void 0))).addButton((button) => button.setCta().setButtonText("Save status").onClick(() => this.finish(this.selectedStatus)));
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) this.finish(void 0);
  }
  finish(status) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(status);
    this.close();
  }
};

// src/main.ts
var WordPressPublisherPlugin = class extends import_obsidian14.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.logger = new PublishLogger();
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new WordPressSettingTab(this.app, this));
    this.localApiServer = new LocalApiServer(this, this.logger);
    await this.restartLocalApiServer();
    this.addCommand({
      id: "publish-current-note-to-wordpress",
      name: "Publish current note to WordPress",
      callback: async () => {
        await this.publishCurrentNote();
      }
    });
    this.addCommand({
      id: "change-wordpress-post-status",
      name: "Change WordPress post status for current note",
      callback: async () => {
        await this.changeCurrentNotePostStatus();
      }
    });
    this.addCommand({
      id: "show-wordpress-remote-status",
      name: "Show WordPress remote post status",
      callback: async () => {
        await this.runRemoteAction("WordPress remote status", (service) => service.showCurrentRemoteStatus());
      }
    });
    this.addCommand({
      id: "unpublish-wordpress-remote-post",
      name: "Unpublish WordPress remote post",
      callback: async () => {
        await this.runRemoteAction("WordPress unpublish", (service) => service.unpublishCurrentPost());
      }
    });
    this.addCommand({
      id: "delete-wordpress-remote-post",
      name: "Delete WordPress remote post",
      callback: async () => {
        await this.runRemoteAction("WordPress delete", (service) => service.deleteCurrentRemotePost());
      }
    });
  }
  async onunload() {
    var _a;
    await ((_a = this.localApiServer) == null ? void 0 : _a.stop());
  }
  async loadSettings() {
    var _a, _b, _c, _d, _e;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.imageCompressionQuality = normalizeNumber(this.settings.imageCompressionQuality, 0.82, 0.1, 1);
    this.settings.largeImageThresholdMb = normalizeNumber(this.settings.largeImageThresholdMb, 2, 0, Number.MAX_SAFE_INTEGER);
    this.settings.mediaCache = (_a = this.settings.mediaCache) != null ? _a : {};
    this.settings.imageStorageProvider = (_b = this.settings.imageStorageProvider) != null ? _b : "wordpress";
    this.settings.aliyunOss = Object.assign({}, DEFAULT_SETTINGS.aliyunOss, (_c = this.settings.aliyunOss) != null ? _c : {});
    this.settings.localApi = Object.assign({}, DEFAULT_SETTINGS.localApi, (_d = this.settings.localApi) != null ? _d : {});
    this.settings.localApi.port = normalizeInteger(this.settings.localApi.port, DEFAULT_SETTINGS.localApi.port, 1, 65535);
    this.settings.encryptedSecrets = (_e = this.settings.encryptedSecrets) != null ? _e : {};
    this.configureLogger();
    this.secretStore = new ElectronSafeStorageSecretStore(this.settings.encryptedSecrets, this.logger);
    this.settings.secretStoreStatus = this.secretStore.status();
    await this.migrateLocalApiKeyStorage();
    await this.migratePlaintextSecrets();
    this.mediaCacheStore = new JsonlMediaCacheStore(this.getMediaCachePath(), this.logger);
    await this.migrateMediaCacheStorage();
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.configureLogger();
  }
  configureLogger() {
    this.logger.configure({
      debug: this.settings.debug,
      logPath: this.getPluginLogPath()
    });
  }
  getPluginLogPath() {
    const basePath = this.getVaultBasePath();
    if (!basePath) return "";
    return `${basePath}/.obsidian/plugins/${this.manifest.id}/logs/plugin.log`;
  }
  getMediaCachePath() {
    const basePath = this.getVaultBasePath();
    if (!basePath) return "";
    return `${basePath}/.obsidian/plugins/${this.manifest.id}/media-cache.jsonl`;
  }
  getVaultBasePath() {
    var _a;
    const adapter = this.app.vault.adapter;
    return (_a = adapter.basePath) != null ? _a : "";
  }
  getDebugConfig() {
    return {
      debug: this.settings.debug,
      pluginLogPath: this.getPluginLogPath()
    };
  }
  async setSecret(key, value) {
    var _a;
    if (!this.secretStore.status().secure) {
      throw new Error((_a = this.secretStore.status().warning) != null ? _a : "Secure secret storage is unavailable.");
    }
    if (!value) {
      await this.secretStore.delete(key);
    } else {
      await this.secretStore.set(key, value);
    }
    this.markSecretSaved(key, Boolean(value));
    await this.saveSettings();
  }
  async deleteSecret(key) {
    await this.secretStore.delete(key);
    this.markSecretSaved(key, false);
    await this.saveSettings();
  }
  async settingsWithSecrets() {
    var _a, _b;
    const settings = structuredClone(this.settings);
    settings.applicationPassword = (_a = await this.secretStore.get("wordpress.applicationPassword")) != null ? _a : "";
    settings.aliyunOss.accessKeySecret = (_b = await this.secretStore.get("aliyun.accessKeySecret")) != null ? _b : "";
    return settings;
  }
  async generateLocalApiKey() {
    const token = generateApiToken();
    const salt = generateApiToken();
    this.settings.localApi.apiKeySalt = salt;
    this.settings.localApi.apiKeyHash = await hashApiKey(token, salt);
    this.settings.localApi.apiKeySaved = true;
    await this.secretStore.delete("localApi.apiKey");
    await this.saveSettings();
    return token;
  }
  async verifyLocalApiKey(token) {
    const { apiKeyHash, apiKeySalt } = this.settings.localApi;
    if (!token || !apiKeyHash || !apiKeySalt) return false;
    const actual = await hashApiKey(token, apiKeySalt);
    return timingSafeEqual(actual, apiKeyHash);
  }
  async restartLocalApiServer() {
    if (!this.localApiServer) return;
    try {
      await this.localApiServer.restart();
    } catch (error) {
      this.logger.error("Failed to start local API server", serializeError8(error));
      new import_obsidian14.Notice(error instanceof Error ? `Local API failed: ${error.message}` : "Local API failed to start", 1e4);
    }
  }
  localApiStatus() {
    var _a;
    if (!this.settings.localApi.enabled) return "disabled";
    return ((_a = this.localApiServer) == null ? void 0 : _a.isRunning()) ? `running on 127.0.0.1:${this.localApiServer.getPort()}` : "stopped";
  }
  async publishCurrentNoteFromApi(options = {}) {
    var _a, _b;
    this.prepareLogSession();
    try {
      const settings = await this.settingsWithSecrets();
      const service = this.createPublishService(settings);
      return await service.publishCurrentNote({ ...options, allowInteractive: (_a = options.allowInteractive) != null ? _a : false, showNotice: (_b = options.showNotice) != null ? _b : false });
    } catch (error) {
      this.logger.error("API publish current note failed", serializeError8(error));
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
      throw error;
    }
  }
  async publishNoteFromApi(path, options = {}) {
    var _a, _b;
    this.prepareLogSession();
    try {
      const settings = await this.settingsWithSecrets();
      const service = this.createPublishService(settings);
      return await service.publishNoteByPath(path, { ...options, allowInteractive: (_a = options.allowInteractive) != null ? _a : false, showNotice: (_b = options.showNotice) != null ? _b : false });
    } catch (error) {
      this.logger.error("API publish note failed", { path, error: serializeError8(error) });
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
      throw error;
    }
  }
  async getRemoteStatusFromApi(path) {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { remote } = await service.getRemoteStatus(path);
    return remote;
  }
  async listPublishedPostsFromApi() {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new PublishedPostsService(this.app, settings, this.logger);
    return service.listPublishedPosts();
  }
  async unpublishFromApi(path) {
    this.assertDestructiveApiAllowed();
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { response } = await service.unpublishPost(path);
    return response;
  }
  async deleteRemotePostFromApi(path, force) {
    this.assertDestructiveApiAllowed();
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { result } = await service.deleteRemotePost(path, force);
    return result;
  }
  async changePostStatusFromApi(path, status) {
    this.prepareLogSession();
    const file = path ? this.app.vault.getAbstractFileByPath(path) : this.app.workspace.getActiveFile();
    if (!file) throw new Error(path ? `Markdown note not found: ${path}` : "No active note. Open a Markdown note first.");
    if (!(file instanceof import_obsidian14.TFile) || file.extension !== "md") throw new Error("The requested file is not a Markdown note.");
    const frontmatter = new FrontmatterService(this.app);
    await frontmatter.writePostStatus(file, status);
    return { path: file.path, status };
  }
  async migratePlaintextSecrets() {
    let changed = false;
    if (this.settings.applicationPassword) {
      if (this.secretStore.status().secure) {
        await this.secretStore.set("wordpress.applicationPassword", this.settings.applicationPassword);
        this.settings.applicationPassword = "";
        this.settings.applicationPasswordSaved = true;
        changed = true;
      } else {
        this.logger.warn("Plaintext WordPress Application Password was found but could not be migrated because secure storage is unavailable.");
      }
    }
    if (this.settings.aliyunOss.accessKeySecret) {
      if (this.secretStore.status().secure) {
        await this.secretStore.set("aliyun.accessKeySecret", this.settings.aliyunOss.accessKeySecret);
        this.settings.aliyunOss.accessKeySecret = "";
        this.settings.aliyunOss.accessKeySecretSaved = true;
        changed = true;
      } else {
        this.logger.warn("Plaintext Aliyun OSS AccessKey Secret was found but could not be migrated because secure storage is unavailable.");
      }
    }
    if (changed) await this.saveSettings();
  }
  async migrateLocalApiKeyStorage() {
    let changed = false;
    if (this.settings.encryptedSecrets["localApi.apiKey"]) {
      await this.secretStore.delete("localApi.apiKey");
      changed = true;
    }
    const hasApiKeyHash = Boolean(this.settings.localApi.apiKeyHash && this.settings.localApi.apiKeySalt);
    if (this.settings.localApi.apiKeySaved !== hasApiKeyHash) {
      this.settings.localApi.apiKeySaved = hasApiKeyHash;
      changed = true;
    }
    if (changed) await this.saveSettings();
  }
  async migrateMediaCacheStorage() {
    var _a;
    const oldCache = (_a = this.settings.mediaCache) != null ? _a : {};
    if (Object.keys(oldCache).length === 0) return;
    const migrated = await this.mediaCacheStore.migrateFromSettingsCache(oldCache);
    if (migrated > 0) {
      this.settings.mediaCache = {};
      await this.saveSettings();
    }
  }
  markSecretSaved(key, saved) {
    if (key === "wordpress.applicationPassword") this.settings.applicationPasswordSaved = saved;
    if (key === "aliyun.accessKeySecret") this.settings.aliyunOss.accessKeySecretSaved = saved;
  }
  async changeCurrentNotePostStatus() {
    var _a;
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) throw new Error("No active note. Open a Markdown note first.");
      if (file.extension !== "md") throw new Error("The active file is not a Markdown note.");
      const frontmatter = new FrontmatterService(this.app);
      const metadata = frontmatter.read(file);
      const currentStatus = (_a = metadata.wp_status) != null ? _a : this.settings.defaultStatus;
      const nextStatus = await choosePostStatus(this.app, currentStatus);
      if (!nextStatus) return;
      await frontmatter.writePostStatus(file, nextStatus);
      new import_obsidian14.Notice(`WordPress post status set to: ${nextStatus}`, 6e3);
    } catch (error) {
      new import_obsidian14.Notice(error instanceof Error ? error.message : "Failed to change post status", 1e4);
    }
  }
  async runRemoteAction(name, action) {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    try {
      await action(service);
    } catch (error) {
      this.logger.error(`${name} failed`, serializeError8(error));
      showErrorLogModal(this.app, `${name} failed`, this.logger, error);
    }
  }
  async publishCurrentNote() {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = this.createPublishService(settings);
    try {
      await service.publishCurrentNote();
    } catch (error) {
      this.logger.error("Publish command failed", serializeError8(error));
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
    }
  }
  prepareLogSession() {
    this.configureLogger();
    this.logger.clear();
  }
  createPublishService(settings) {
    return new PublishService(this.app, settings, this.logger, this.mediaCacheStore, async () => {
      this.settings.aliyunOss.endpoint = settings.aliyunOss.endpoint;
      await this.saveSettings();
    });
  }
  assertDestructiveApiAllowed() {
    if (!this.settings.localApi.allowDestructiveActions) {
      throw new Error("Destructive local API actions are disabled in plugin settings.");
    }
  }
};
function serializeError8(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
function normalizeNumber(value, fallback, min, max) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
function normalizeInteger(value, fallback, min, max) {
  return Math.round(normalizeNumber(value, fallback, min, max));
}
function generateApiToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashApiKey(token, salt) {
  if (!crypto.subtle) {
    throw new Error("Web Crypto API is unavailable; cannot hash local API key.");
  }
  const bytes = new TextEncoder().encode(`${salt}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
