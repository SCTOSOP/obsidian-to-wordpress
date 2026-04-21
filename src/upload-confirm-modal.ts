import { App, Modal, Setting } from "obsidian";

export interface LargeUploadInfo {
  fileName: string;
  originalBytes: number;
  uploadBytes: number;
  thresholdBytes: number;
  compressed: boolean;
}

export function confirmLargeImageUpload(app: App, info: LargeUploadInfo): Promise<boolean> {
  return new Promise((resolve) => {
    new LargeImageUploadModal(app, info, resolve).open();
  });
}

class LargeImageUploadModal extends Modal {
  private resolved = false;

  constructor(app: App, private info: LargeUploadInfo, private resolve: (value: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Large image upload" });
    contentEl.createEl("p", {
      text: `${this.info.fileName} is ${formatBytes(this.info.uploadBytes)} after processing, which exceeds your ${formatBytes(this.info.thresholdBytes)} threshold.`,
    });
    contentEl.createEl("p", {
      text: this.info.compressed
        ? `Original size: ${formatBytes(this.info.originalBytes)}. The image was compressed before this check.`
        : "This image could not be compressed smaller, so the original file will be uploaded.",
    });

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Cancel upload")
        .onClick(() => this.finish(false)))
      .addButton((button) => button
        .setCta()
        .setButtonText("Upload anyway")
        .onClick(() => this.finish(true)));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.finish(false);
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
