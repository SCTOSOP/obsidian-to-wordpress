import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import { confirmEndpointSwitch } from "./endpoint-switch-modal";
import { createImageStorageProvider, createTestImageUploadInput } from "./storage/image-storage-provider";
import { AliyunOssEndpointMismatchError } from "./storage/aliyun-oss-provider";
import { HttpMediaUrlChecker } from "./media-url-checker";
import { PublishLogger, showErrorLogModal } from "./logger";
import type WordPressPublisherPlugin from "./main";
import type { WordPressPluginSettings } from "./types";

export const DEFAULT_SETTINGS: WordPressPluginSettings = {
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
    testReferer: "",
  },
  localApi: {
    enabled: false,
    port: 27187,
    apiKeySaved: false,
    apiKeySalt: "",
    apiKeyHash: "",
    allowInteractive: false,
    allowDestructiveActions: false,
  },
  encryptedSecrets: {},
  mediaCache: {},
};

export class WordPressSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WordPressPublisherPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    let applicationPasswordInput = "";
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian to WordPress" });

    const secretStatus = this.plugin.settings.secretStoreStatus;
    if (secretStatus) {
      containerEl.createEl("p", {
        text: secretStatus.warning
          ? `Secret storage warning: ${secretStatus.warning}`
          : `Secret storage: ${secretStatus.backend} (${secretStatus.secure ? "secure" : "not secure"})`,
      });
    }

    new Setting(containerEl)
      .setName("WordPress site URL")
      .setDesc("Self-hosted WordPress base URL, for example https://example.com")
      .addText((text) => text
        .setPlaceholder("https://example.com")
        .setValue(this.plugin.settings.siteUrl)
        .onChange(async (value) => {
          this.plugin.settings.siteUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Username")
      .setDesc("WordPress username used with an Application Password.")
      .addText((text) => text
        .setPlaceholder("wordpress-user")
        .setValue(this.plugin.settings.username)
        .onChange(async (value) => {
          this.plugin.settings.username = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Application Password")
      .setDesc(this.plugin.settings.applicationPasswordSaved
        ? "Saved encrypted with Electron safeStorage. Enter a new value to replace it."
        : "WordPress Application Password. Saved encrypted with Electron safeStorage.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("xxxx xxxx xxxx xxxx xxxx xxxx")
          .onChange(async (value) => {
            applicationPasswordInput = value;
          });
      })
      .addButton((button) => button
        .setCta()
        .setButtonText("Save")
        .onClick(async () => {
          await this.plugin.setSecret("wordpress.applicationPassword", applicationPasswordInput);
          this.display();
        }))
      .addButton((button) => button
        .setButtonText("Clear")
        .onClick(async () => {
          await this.plugin.deleteSecret("wordpress.applicationPassword");
          this.display();
        }));

    new Setting(containerEl)
      .setName("Default post status")
      .setDesc("Used when a note does not already contain WordPress frontmatter.")
      .addDropdown((dropdown) => dropdown
        .addOption("draft", "Draft")
        .addOption("publish", "Publish")
        .addOption("private", "Private")
        .addOption("pending", "Pending")
        .setValue(this.plugin.settings.defaultStatus)
        .onChange(async (value) => {
          this.plugin.settings.defaultStatus = value as WordPressPluginSettings["defaultStatus"];
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Image upload" });

    new Setting(containerEl)
      .setName("Image storage provider")
      .setDesc("Choose where local images are uploaded before their URLs are inserted into WordPress posts.")
      .addDropdown((dropdown) => dropdown
        .addOption("wordpress", "WordPress Media Library")
        .addOption("aliyun-oss", "Aliyun OSS")
        .setValue(this.plugin.settings.imageStorageProvider)
        .onChange(async (value) => {
          this.plugin.settings.imageStorageProvider = value as WordPressPluginSettings["imageStorageProvider"];
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Image compression quality")
      .setDesc("JPEG/WebP compression quality from 0.1 to 1. PNG images without transparency may be converted to JPEG.")
      .addSlider((slider) => slider
        .setLimits(0.1, 1, 0.01)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.imageCompressionQuality)
        .onChange(async (value) => {
          this.plugin.settings.imageCompressionQuality = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Large image threshold")
      .setDesc("Ask before uploading an image if the prepared upload size exceeds this threshold in MB. Set 0 to disable the warning.")
      .addText((text) => text
        .setPlaceholder("2")
        .setValue(String(this.plugin.settings.largeImageThresholdMb))
        .onChange(async (value) => {
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

  private displayDebugSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Debug" });
    const pluginLogPath = this.plugin.getPluginLogPath();
    const mcpLogPath = "/tmp/obsidian-to-wordpress-mcp.log";

    const debugSetting = new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("When enabled, write detailed plugin and MCP logs to files. Obsidian only shows error logs when an operation fails.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.debug)
        .onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.debug) {
      debugSetting
        .addButton((button) => button
          .setButtonText("Copy log paths")
          .onClick(async () => {
            const value = [
              `Plugin log: ${pluginLogPath || "(unavailable in this Obsidian adapter)"}`,
              `MCP log: ${mcpLogPath}`,
            ].join("\n");
            await navigator.clipboard.writeText(value);
            new Notice("Log paths copied", 4000);
          }));
    }

    markWarningSetting(debugSetting);
  }

  private displayLocalApiSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Local API / MCP" });
    containerEl.createEl("p", {
      text: `Status: ${this.plugin.localApiStatus()}. The local API listens on 127.0.0.1 only and is intended for MCP clients such as Codex.`,
    });

    const enableApiSetting = new Setting(containerEl)
      .setName("Enable local API")
      .setDesc("Allow a local MCP bridge to ask this Obsidian plugin to publish notes. Requires an API key.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.localApi.enabled)
        .onChange(async (value) => {
          if (value) {
            const confirmed = await confirmDangerousSetting(
              this.app,
              "Enable local API?",
              "This opens a localhost API that can publish notes through this Obsidian plugin when the caller has your API key.",
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

    new Setting(containerEl)
      .setName("API port")
      .setDesc("Localhost port used by the Obsidian plugin API. Default: 27187.")
      .addText((text) => text
        .setPlaceholder("27187")
        .setValue(String(this.plugin.settings.localApi.port))
        .onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
            this.plugin.settings.localApi.port = parsed;
            await this.plugin.saveSettings();
            await this.plugin.restartLocalApiServer();
          }
        }));

    new Setting(containerEl)
      .setName("API key")
      .setDesc(this.plugin.settings.localApi.apiKeySaved
        ? "An API key exists. It is never shown again. Generate a new key if you forgot it; the old key will stop working."
        : "No API key exists. Generate one before connecting an MCP client.")
      .addButton((button) => button
        .setCta()
        .setButtonText(this.plugin.settings.localApi.apiKeySaved ? "Regenerate" : "Generate")
        .onClick(async () => {
          const token = await this.plugin.generateLocalApiKey();
          new ApiKeyModal(this.app, token).open();
          await this.plugin.restartLocalApiServer();
          this.display();
        }));

    const interactiveSetting = new Setting(containerEl)
      .setName("Allow interactive Obsidian modals from API")
      .setDesc("If enabled, API calls may open Obsidian modals for missing metadata or confirmations. Disabled is safer for automation.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.localApi.allowInteractive)
        .onChange(async (value) => {
          if (value) {
            const confirmed = await confirmDangerousSetting(
              this.app,
              "Allow API-triggered Obsidian modals?",
              "MCP/API calls may open publish dialogs, overwrite confirmations, and large upload confirmations in Obsidian. This can cause automation to wait for your manual action.",
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

    const destructiveSetting = new Setting(containerEl)
      .setName("Allow destructive API actions")
      .setDesc("Reserved for future delete/unpublish MCP tools. Keep disabled unless you explicitly need remote deletion from MCP.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.localApi.allowDestructiveActions)
        .onChange(async (value) => {
          if (value) {
            const confirmed = await confirmDangerousSetting(
              this.app,
              "Allow destructive API actions?",
              "Future MCP/API tools may be allowed to unpublish or delete remote WordPress posts. Only enable this if you understand the risk.",
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

  private displayAliyunOssSettings(containerEl: HTMLElement): void {
    let accessKeySecretInput = "";
    containerEl.createEl("h3", { text: "Aliyun OSS" });

    new Setting(containerEl)
      .setName("OSS endpoint")
      .setDesc("Example: https://oss-cn-hangzhou.aliyuncs.com or https://bucket.oss-cn-hangzhou.aliyuncs.com")
      .addText((text) => text
        .setPlaceholder("https://oss-cn-hangzhou.aliyuncs.com")
        .setValue(this.plugin.settings.aliyunOss.endpoint)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.endpoint = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("OSS bucket")
      .setDesc("Bucket name. If your endpoint already includes the bucket, this is still used for request signing.")
      .addText((text) => text
        .setPlaceholder("my-bucket")
        .setValue(this.plugin.settings.aliyunOss.bucket)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.bucket = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("AccessKey ID")
      .setDesc("Aliyun AccessKey ID with permission to put objects into the bucket.")
      .addText((text) => text
        .setValue(this.plugin.settings.aliyunOss.accessKeyId)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.accessKeyId = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("AccessKey Secret")
      .setDesc(this.plugin.settings.aliyunOss.accessKeySecretSaved
        ? "Saved encrypted with Electron safeStorage. Enter a new value to replace it."
        : "Aliyun AccessKey Secret. Saved encrypted with Electron safeStorage.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.onChange(async (value) => {
          accessKeySecretInput = value;
        });
      })
      .addButton((button) => button
        .setCta()
        .setButtonText("Save")
        .onClick(async () => {
          await this.plugin.setSecret("aliyun.accessKeySecret", accessKeySecretInput);
          this.display();
        }))
      .addButton((button) => button
        .setButtonText("Clear")
        .onClick(async () => {
          await this.plugin.deleteSecret("aliyun.accessKeySecret");
          this.display();
        }));

    new Setting(containerEl)
      .setName("Public base URL")
      .setDesc("The URL prefix inserted into posts. Usually your CDN domain or OSS public endpoint, for example https://img.example.com")
      .addText((text) => text
        .setPlaceholder("https://img.example.com")
        .setValue(this.plugin.settings.aliyunOss.publicBaseUrl)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.publicBaseUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("OSS object key rule")
      .setDesc("Available tokens: {postTitle}, {fileName}, {fileBaseName}, {ext}, {yyyy}, {mm}, {dd}, {hash}. Example: {postTitle}/{fileName}")
      .addText((text) => text
        .setPlaceholder("{postTitle}/{fileName}")
        .setValue(this.plugin.settings.aliyunOss.objectKeyRule)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.objectKeyRule = value.trim() || DEFAULT_SETTINGS.aliyunOss.objectKeyRule;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Test Referer")
      .setDesc("Optional. Use your blog URL when OSS hotlink protection only allows your blog domain, for example https://blog.example.com/")
      .addText((text) => text
        .setPlaceholder("https://blog.example.com/")
        .setValue(this.plugin.settings.aliyunOss.testReferer)
        .onChange(async (value) => {
          this.plugin.settings.aliyunOss.testReferer = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Upload OSS test image")
      .setDesc("Uploads a tiny generated PNG and checks whether its public URL can be reached. If hotlink protection is enabled, configure Test Referer first.")
      .addButton((button) => button
        .setButtonText("Upload test image")
        .onClick(async () => {
          await this.runOssUploadTest();
        }));
  }

  private async runOssUploadTest(): Promise<void> {
    const logger = new PublishLogger({
      debug: this.plugin.settings.debug,
      logPath: this.plugin.getPluginLogPath(),
    });
    try {
      const settings = await this.plugin.settingsWithSecrets();
      const provider = createImageStorageProvider(settings, undefined, logger);
      const result = await provider.uploadImage(createTestImageUploadInput(settings.aliyunOss.objectKeyRule));
      logger.info("OSS test upload completed", result);

      const checker = new HttpMediaUrlChecker(logger);
      const status = await checker.check(result.url, settings.aliyunOss.testReferer || undefined);
      logger.info("OSS test URL check completed", { url: result.url, status, referer: settings.aliyunOss.testReferer });

      new Notice(`OSS test upload ${status === "missing" ? "uploaded but URL is not accessible" : "completed"}: ${result.url}`, 12000);
      if (status !== "available") {
        logger.error("OSS test upload URL is not accessible", { url: result.url, status });
        showErrorLogModal(this.app, "OSS test upload failed", logger);
      }
    } catch (error) {
      if (error instanceof AliyunOssEndpointMismatchError) {
        logger.warn("OSS endpoint mismatch detected", {
          currentEndpoint: error.currentEndpoint,
          recommendedEndpoint: error.recommendedEndpoint,
        });
        const shouldSwitch = await confirmEndpointSwitch(this.app, error.currentEndpoint, error.recommendedEndpoint);
        if (shouldSwitch) {
          this.plugin.settings.aliyunOss.endpoint = error.recommendedEndpoint;
          await this.plugin.saveSettings();
          new Notice(`OSS endpoint updated to ${error.recommendedEndpoint}. Please run the test again.`, 10000);
          this.display();
        } else {
          new Notice(error.message, 10000);
        }
        showErrorLogModal(this.app, "OSS test upload failed", logger, error);
        return;
      }

      logger.error("OSS test upload failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
      showErrorLogModal(this.app, "OSS test upload failed", logger, error);
    }
  }
}

class ApiKeyModal extends Modal {
  constructor(app: App, private token: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Local API key" });
    contentEl.createEl("p", {
      text: "Copy this API key now. It will not be shown again. If you lose it, generate a new key and the old key will be invalidated.",
    });

    new Setting(contentEl)
      .setName("API key")
      .addText((text) => {
        text.setValue(this.token);
        text.inputEl.readOnly = true;
        text.inputEl.select();
      });

    new Setting(contentEl)
      .addButton((button) => button
        .setCta()
        .setButtonText("Copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(this.token);
          new Notice("API key copied", 4000);
        }))
      .addButton((button) => button
        .setButtonText("Close")
        .onClick(() => this.close()));
  }
}

function markDangerSetting(setting: Setting): void {
  setting.settingEl.style.borderLeft = "3px solid var(--text-error)";
  setting.settingEl.style.paddingLeft = "12px";
  setting.nameEl.style.color = "var(--text-error)";
  setting.descEl.style.color = "var(--text-error)";
}

function markWarningSetting(setting: Setting): void {
  setting.settingEl.style.borderLeft = "3px solid var(--text-warning)";
  setting.settingEl.style.paddingLeft = "12px";
  setting.nameEl.style.color = "var(--text-warning)";
  setting.descEl.style.color = "var(--text-warning)";
}

function confirmDangerousSetting(app: App, title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    new DangerousSettingConfirmModal(app, title, message, resolve).open();
  });
}

class DangerousSettingConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private message: string,
    private resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title }).style.color = "var(--text-error)";
    contentEl.createEl("p", { text: this.message });
    contentEl.createEl("p", {
      text: "Confirm only if you trust the local MCP client and understand what this setting allows.",
    });

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Cancel")
        .onClick(() => this.finish(false)))
      .addButton((button) => {
        button
          .setWarning()
          .setButtonText("Enable")
          .onClick(() => this.finish(true));
      });
  }

  onClose(): void {
    this.resolve(false);
  }

  private finish(confirmed: boolean): void {
    const resolve = this.resolve;
    this.resolve = () => undefined;
    resolve(confirmed);
    this.close();
  }
}
