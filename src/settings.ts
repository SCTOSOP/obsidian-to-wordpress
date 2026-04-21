import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { confirmEndpointSwitch } from "./endpoint-switch-modal";
import { createImageStorageProvider, createTestImageUploadInput } from "./storage/image-storage-provider";
import { AliyunOssEndpointMismatchError } from "./storage/aliyun-oss-provider";
import { HttpMediaUrlChecker } from "./media-url-checker";
import { PublishLogger, showLogNotice } from "./logger";
import type WordPressPublisherPlugin from "./main";
import type { WordPressPluginSettings } from "./types";

export const DEFAULT_SETTINGS: WordPressPluginSettings = {
  siteUrl: "",
  username: "",
  applicationPassword: "",
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
    publicBaseUrl: "",
    objectKeyRule: "obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}",
    testReferer: "",
  },
  mediaCache: {},
};

export class WordPressSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: WordPressPublisherPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian to WordPress" });

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
      .setDesc("WordPress Application Password. Stored in Obsidian plugin data for this demo.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("xxxx xxxx xxxx xxxx xxxx xxxx")
          .setValue(this.plugin.settings.applicationPassword)
          .onChange(async (value) => {
            this.plugin.settings.applicationPassword = value;
            await this.plugin.saveSettings();
          });
      });

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

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("When enabled, show full publish logs after every upload. Otherwise logs are shown only on failure.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.debug)
        .onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        }));
  }

  private displayAliyunOssSettings(containerEl: HTMLElement): void {
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
      .setDesc("Stored in Obsidian plugin data for this direct-upload demo.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.aliyunOss.accessKeySecret)
          .onChange(async (value) => {
            this.plugin.settings.aliyunOss.accessKeySecret = value;
            await this.plugin.saveSettings();
          });
      });

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
    const logger = new PublishLogger();
    try {
      const provider = createImageStorageProvider(this.plugin.settings, undefined, logger);
      const result = await provider.uploadImage(createTestImageUploadInput(this.plugin.settings.aliyunOss.objectKeyRule));
      logger.info("OSS test upload completed", result);

      const checker = new HttpMediaUrlChecker(logger);
      const status = await checker.check(result.url, this.plugin.settings.aliyunOss.testReferer || undefined);
      logger.info("OSS test URL check completed", { url: result.url, status, referer: this.plugin.settings.aliyunOss.testReferer });

      new Notice(`OSS test upload ${status === "missing" ? "uploaded but URL is not accessible" : "completed"}: ${result.url}`, 12000);
      if (this.plugin.settings.debug || status !== "available") {
        showLogNotice("OSS test upload log", logger);
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
        showLogNotice("OSS test upload failed", logger);
        return;
      }

      logger.error("OSS test upload failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
      new Notice(error instanceof Error ? error.message : "OSS test upload failed", 10000);
      showLogNotice("OSS test upload failed", logger);
    }
  }
}
