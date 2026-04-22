import { Notice, Plugin, TFile } from "obsidian";
import { LocalApiServer } from "./api/local-api-server";
import { FrontmatterService } from "./frontmatter";
import { showErrorLogModal, PublishLogger } from "./logger";
import { PublishedPostsService } from "./published-posts-service";
import { PublishService } from "./publisher";
import { RemotePostService } from "./remote-post-service";
import { ElectronSafeStorageSecretStore, type SecretStore } from "./secret-store";
import { DEFAULT_SETTINGS, WordPressSettingTab } from "./settings";
import { choosePostStatus } from "./status-modal";
import type { PublishedPostStatusItem, PublishOptions, PublishResult, WordPressPluginSettings, WordPressPostResponse, WordPressPostStatus, WordPressDeleteResponse } from "./types";

export default class WordPressPublisherPlugin extends Plugin {
  settings: WordPressPluginSettings = DEFAULT_SETTINGS;
  private logger = new PublishLogger();
  secretStore!: SecretStore;
  private localApiServer?: LocalApiServer;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new WordPressSettingTab(this.app, this));
    this.localApiServer = new LocalApiServer(this, this.logger);
    await this.restartLocalApiServer();

    this.addCommand({
      id: "publish-current-note-to-wordpress",
      name: "Publish current note to WordPress",
      callback: async () => {
        await this.publishCurrentNote();
      },
    });

    this.addCommand({
      id: "change-wordpress-post-status",
      name: "Change WordPress post status for current note",
      callback: async () => {
        await this.changeCurrentNotePostStatus();
      },
    });

    this.addCommand({
      id: "show-wordpress-remote-status",
      name: "Show WordPress remote post status",
      callback: async () => {
        await this.runRemoteAction("WordPress remote status", (service) => service.showCurrentRemoteStatus());
      },
    });

    this.addCommand({
      id: "unpublish-wordpress-remote-post",
      name: "Unpublish WordPress remote post",
      callback: async () => {
        await this.runRemoteAction("WordPress unpublish", (service) => service.unpublishCurrentPost());
      },
    });

    this.addCommand({
      id: "delete-wordpress-remote-post",
      name: "Delete WordPress remote post",
      callback: async () => {
        await this.runRemoteAction("WordPress delete", (service) => service.deleteCurrentRemotePost());
      },
    });
  }

  async onunload(): Promise<void> {
    await this.localApiServer?.stop();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.imageCompressionQuality = normalizeNumber(this.settings.imageCompressionQuality, 0.82, 0.1, 1);
    this.settings.largeImageThresholdMb = normalizeNumber(this.settings.largeImageThresholdMb, 2, 0, Number.MAX_SAFE_INTEGER);
    this.settings.mediaCache = this.settings.mediaCache ?? {};
    this.settings.imageStorageProvider = this.settings.imageStorageProvider ?? "wordpress";
    this.settings.aliyunOss = Object.assign({}, DEFAULT_SETTINGS.aliyunOss, this.settings.aliyunOss ?? {});
    this.settings.localApi = Object.assign({}, DEFAULT_SETTINGS.localApi, this.settings.localApi ?? {});
    this.settings.localApi.port = normalizeInteger(this.settings.localApi.port, DEFAULT_SETTINGS.localApi.port, 1, 65535);
    this.settings.encryptedSecrets = this.settings.encryptedSecrets ?? {};
    this.configureLogger();
    this.secretStore = new ElectronSafeStorageSecretStore(this.settings.encryptedSecrets, this.logger);
    this.settings.secretStoreStatus = this.secretStore.status();
    await this.migrateLocalApiKeyStorage();
    await this.migratePlaintextSecrets();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureLogger();
  }

  configureLogger(): void {
    this.logger.configure({
      debug: this.settings.debug,
      logPath: this.getPluginLogPath(),
    });
  }

  getPluginLogPath(): string {
    const adapter = this.app.vault.adapter as { basePath?: string };
    if (!adapter.basePath) return "";
    return `${adapter.basePath}/.obsidian/plugins/${this.manifest.id}/logs/plugin.log`;
  }

  getDebugConfig(): { debug: boolean; pluginLogPath: string } {
    return {
      debug: this.settings.debug,
      pluginLogPath: this.getPluginLogPath(),
    };
  }

  async setSecret(key: SecretKey, value: string): Promise<void> {
    if (!this.secretStore.status().secure) {
      throw new Error(this.secretStore.status().warning ?? "Secure secret storage is unavailable.");
    }
    if (!value) {
      await this.secretStore.delete(key);
    } else {
      await this.secretStore.set(key, value);
    }
    this.markSecretSaved(key, Boolean(value));
    await this.saveSettings();
  }

  async deleteSecret(key: SecretKey): Promise<void> {
    await this.secretStore.delete(key);
    this.markSecretSaved(key, false);
    await this.saveSettings();
  }

  async settingsWithSecrets(): Promise<WordPressPluginSettings> {
    const settings = structuredClone(this.settings) as WordPressPluginSettings;
    settings.applicationPassword = await this.secretStore.get("wordpress.applicationPassword") ?? "";
    settings.aliyunOss.accessKeySecret = await this.secretStore.get("aliyun.accessKeySecret") ?? "";
    return settings;
  }

  async generateLocalApiKey(): Promise<string> {
    const token = generateApiToken();
    const salt = generateApiToken();
    this.settings.localApi.apiKeySalt = salt;
    this.settings.localApi.apiKeyHash = await hashApiKey(token, salt);
    this.settings.localApi.apiKeySaved = true;
    await this.secretStore.delete("localApi.apiKey");
    await this.saveSettings();
    return token;
  }

  async verifyLocalApiKey(token: string): Promise<boolean> {
    const { apiKeyHash, apiKeySalt } = this.settings.localApi;
    if (!token || !apiKeyHash || !apiKeySalt) return false;
    const actual = await hashApiKey(token, apiKeySalt);
    return timingSafeEqual(actual, apiKeyHash);
  }

  async restartLocalApiServer(): Promise<void> {
    if (!this.localApiServer) return;
    try {
      await this.localApiServer.restart();
    } catch (error) {
      this.logger.error("Failed to start local API server", serializeError(error));
      new Notice(error instanceof Error ? `Local API failed: ${error.message}` : "Local API failed to start", 10000);
    }
  }

  localApiStatus(): string {
    if (!this.settings.localApi.enabled) return "disabled";
    return this.localApiServer?.isRunning() ? `running on 127.0.0.1:${this.localApiServer.getPort()}` : "stopped";
  }

  async publishCurrentNoteFromApi(options: PublishOptions = {}): Promise<PublishResult | undefined> {
    this.prepareLogSession();
    try {
      const settings = await this.settingsWithSecrets();
      const service = this.createPublishService(settings);
      return await service.publishCurrentNote({ ...options, allowInteractive: options.allowInteractive ?? false, showNotice: options.showNotice ?? false });
    } catch (error) {
      this.logger.error("API publish current note failed", serializeError(error));
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
      throw error;
    }
  }

  async publishNoteFromApi(path: string, options: PublishOptions = {}): Promise<PublishResult | undefined> {
    this.prepareLogSession();
    try {
      const settings = await this.settingsWithSecrets();
      const service = this.createPublishService(settings);
      return await service.publishNoteByPath(path, { ...options, allowInteractive: options.allowInteractive ?? false, showNotice: options.showNotice ?? false });
    } catch (error) {
      this.logger.error("API publish note failed", { path, error: serializeError(error) });
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
      throw error;
    }
  }

  async getRemoteStatusFromApi(path?: string): Promise<WordPressPostResponse> {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { remote } = await service.getRemoteStatus(path);
    return remote;
  }

  async listPublishedPostsFromApi(): Promise<PublishedPostStatusItem[]> {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new PublishedPostsService(this.app, settings, this.logger);
    return service.listPublishedPosts();
  }

  async unpublishFromApi(path?: string): Promise<WordPressPostResponse> {
    this.assertDestructiveApiAllowed();
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { response } = await service.unpublishPost(path);
    return response;
  }

  async deleteRemotePostFromApi(path: string | undefined, force: boolean): Promise<WordPressDeleteResponse> {
    this.assertDestructiveApiAllowed();
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);
    const { result } = await service.deleteRemotePost(path, force);
    return result;
  }

  async changePostStatusFromApi(path: string | undefined, status: WordPressPostStatus): Promise<{ path: string; status: WordPressPostStatus }> {
    this.prepareLogSession();
    const file = path ? this.app.vault.getAbstractFileByPath(path) : this.app.workspace.getActiveFile();
    if (!file) throw new Error(path ? `Markdown note not found: ${path}` : "No active note. Open a Markdown note first.");
    if (!(file instanceof TFile) || file.extension !== "md") throw new Error("The requested file is not a Markdown note.");
    const frontmatter = new FrontmatterService(this.app);
    await frontmatter.writePostStatus(file, status);
    return { path: file.path, status };
  }

  private async migratePlaintextSecrets(): Promise<void> {
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

  private async migrateLocalApiKeyStorage(): Promise<void> {
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

  private markSecretSaved(key: SecretKey, saved: boolean): void {
    if (key === "wordpress.applicationPassword") this.settings.applicationPasswordSaved = saved;
    if (key === "aliyun.accessKeySecret") this.settings.aliyunOss.accessKeySecretSaved = saved;
  }

  private async changeCurrentNotePostStatus(): Promise<void> {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file) throw new Error("No active note. Open a Markdown note first.");
      if (file.extension !== "md") throw new Error("The active file is not a Markdown note.");

      const frontmatter = new FrontmatterService(this.app);
      const metadata = frontmatter.read(file);
      const currentStatus = metadata.wp_status ?? this.settings.defaultStatus;
      const nextStatus = await choosePostStatus(this.app, currentStatus);
      if (!nextStatus) return;

      await frontmatter.writePostStatus(file, nextStatus);
      new Notice(`WordPress post status set to: ${nextStatus}`, 6000);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Failed to change post status", 10000);
    }
  }

  private async runRemoteAction(name: string, action: (service: RemotePostService) => Promise<void>): Promise<void> {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);

    try {
      await action(service);
    } catch (error) {
      this.logger.error(`${name} failed`, serializeError(error));
      showErrorLogModal(this.app, `${name} failed`, this.logger, error);
    }
  }

  private async publishCurrentNote(): Promise<void> {
    this.prepareLogSession();
    const settings = await this.settingsWithSecrets();
    const service = this.createPublishService(settings);

    try {
      await service.publishCurrentNote();
    } catch (error) {
      this.logger.error("Publish command failed", serializeError(error));
      showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
    }
  }

  private prepareLogSession(): void {
    this.configureLogger();
    this.logger.clear();
  }

  private createPublishService(settings: WordPressPluginSettings): PublishService {
    return new PublishService(this.app, settings, this.logger, async () => {
      this.settings.mediaCache = settings.mediaCache;
      this.settings.aliyunOss.endpoint = settings.aliyunOss.endpoint;
      await this.saveSettings();
    });
  }

  private assertDestructiveApiAllowed(): void {
    if (!this.settings.localApi.allowDestructiveActions) {
      throw new Error("Destructive local API actions are disabled in plugin settings.");
    }
  }
}

type SecretKey = "wordpress.applicationPassword" | "aliyun.accessKeySecret";

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function normalizeNumber(value: number, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeInteger(value: number, fallback: number, min: number, max: number): number {
  return Math.round(normalizeNumber(value, fallback, min, max));
}

function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashApiKey(token: string, salt: string): Promise<string> {
  if (!crypto.subtle) {
    throw new Error("Web Crypto API is unavailable; cannot hash local API key.");
  }
  const bytes = new TextEncoder().encode(`${salt}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
