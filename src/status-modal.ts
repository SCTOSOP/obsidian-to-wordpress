import { App, Modal, Setting } from "obsidian";
import type { WordPressPostStatus } from "./types";

export function choosePostStatus(app: App, currentStatus: WordPressPostStatus): Promise<WordPressPostStatus | undefined> {
  return new Promise((resolve) => {
    new PostStatusModal(app, currentStatus, resolve).open();
  });
}

class PostStatusModal extends Modal {
  private selectedStatus: WordPressPostStatus;
  private resolved = false;

  constructor(
    app: App,
    currentStatus: WordPressPostStatus,
    private resolve: (status: WordPressPostStatus | undefined) => void,
  ) {
    super(app);
    this.selectedStatus = currentStatus;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "WordPress publish status" });
    contentEl.createEl("p", { text: "Choose the status that should be used on the next publish." });

    new Setting(contentEl)
      .setName("Status")
      .addDropdown((dropdown) => dropdown
        .addOption("draft", "Draft")
        .addOption("publish", "Publish")
        .addOption("private", "Private")
        .addOption("pending", "Pending")
        .setValue(this.selectedStatus)
        .onChange((value) => { this.selectedStatus = value as WordPressPostStatus; }));

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(undefined)))
      .addButton((button) => button.setCta().setButtonText("Save status").onClick(() => this.finish(this.selectedStatus)));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.finish(undefined);
  }

  private finish(status: WordPressPostStatus | undefined): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(status);
    this.close();
  }
}
