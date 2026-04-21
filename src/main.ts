import { Notice, Plugin } from "obsidian";
import { FrontmatterService } from "./frontmatter";
import { showLogNotice, PublishLogger } from "./logger";
import { PublishService } from "./publisher";
import { RemotePostService } from "./remote-post-service";
import { ElectronSafeStorageSecretStore, type SecretStore } from "./secret-store";
import { DEFAULT_SETTINGS, WordPressSettingTab } from "./settings";
import { choosePostStatus } from "./status-modal";
import type { WordPressPluginSettings } from "./types";

export default class WordPressPublisherPlugin extends Plugin {
  settings: WordPressPluginSettings = DEFAULT_SETTINGS;
  private logger = new PublishLogger();
  secretStore!: SecretStore;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new WordPressSettingTab(this.app, this));

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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.imageCompressionQuality = normalizeNumber(this.settings.imageCompressionQuality, 0.82, 0.1, 1);
    this.settings.largeImageThresholdMb = normalizeNumber(this.settings.largeImageThresholdMb, 2, 0, Number.MAX_SAFE_INTEGER);
    this.settings.mediaCache = this.settings.mediaCache ?? {};
    this.settings.imageStorageProvider = this.settings.imageStorageProvider ?? "wordpress";
    this.settings.aliyunOss = Object.assign({}, DEFAULT_SETTINGS.aliyunOss, this.settings.aliyunOss ?? {});
    this.settings.encryptedSecrets = this.settings.encryptedSecrets ?? {};
    this.secretStore = new ElectronSafeStorageSecretStore(this.settings.encryptedSecrets, this.logger);
    this.settings.secretStoreStatus = this.secretStore.status();
    await this.migratePlaintextSecrets();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setSecret(key: "wordpress.applicationPassword" | "aliyun.accessKeySecret", value: string): Promise<void> {
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

  async deleteSecret(key: "wordpress.applicationPassword" | "aliyun.accessKeySecret"): Promise<void> {
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

  private markSecretSaved(key: "wordpress.applicationPassword" | "aliyun.accessKeySecret", saved: boolean): void {
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
    this.logger.clear();
    const settings = await this.settingsWithSecrets();
    const service = new RemotePostService(this.app, settings, this.logger);

    try {
      await action(service);
      if (this.settings.debug) {
        showLogNotice(`${name} debug log`, this.logger);
      }
    } catch (error) {
      this.logger.error(`${name} failed`, serializeError(error));
      new Notice(error instanceof Error ? error.message : `${name} failed`, 10000);
      showLogNotice(`${name} failed`, this.logger);
    }
  }

  private async publishCurrentNote(): Promise<void> {
    this.logger.clear();
    const settings = await this.settingsWithSecrets();
    const service = new PublishService(this.app, settings, this.logger, async () => {
      this.settings.mediaCache = settings.mediaCache;
      this.settings.aliyunOss.endpoint = settings.aliyunOss.endpoint;
      await this.saveSettings();
    });

    try {
      await service.publishCurrentNote();
      if (this.settings.debug) {
        showLogNotice("WordPress publish debug log", this.logger);
      }
    } catch (error) {
      this.logger.error("Publish command failed", serializeError(error));
      new Notice(error instanceof Error ? error.message : "Publish failed", 10000);
      showLogNotice("WordPress publish failed", this.logger);
    }
  }
}

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
