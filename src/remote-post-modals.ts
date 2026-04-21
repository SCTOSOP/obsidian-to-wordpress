import { App, Modal, Setting } from "obsidian";
import type { WordPressPostResponse } from "./types";

export type ConflictDecision = "overwrite" | "cancel";
export type DeleteDecision = "trash" | "delete" | "cancel";

export function confirmRemoteOverwrite(app: App, remote: WordPressPostResponse, localUpdatedAt?: string): Promise<ConflictDecision> {
  return new Promise((resolve) => {
    new RemoteConflictModal(app, remote, localUpdatedAt, resolve).open();
  });
}

export function confirmRemoteDelete(app: App, remote: WordPressPostResponse): Promise<DeleteDecision> {
  return new Promise((resolve) => {
    new RemoteDeleteModal(app, remote, resolve).open();
  });
}

export class RemoteStatusModal extends Modal {
  constructor(app: App, private remote: WordPressPostResponse) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "WordPress remote post status" });
    renderPostSummary(contentEl, this.remote);
    new Setting(contentEl).addButton((button) => button.setButtonText("Close").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class RemoteConflictModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private remote: WordPressPostResponse,
    private localUpdatedAt: string | undefined,
    private resolve: (value: ConflictDecision) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Remote post changed" });
    contentEl.createEl("p", {
      text: "The WordPress post appears to have been modified after the last successful publish from Obsidian.",
    });
    renderPostSummary(contentEl, this.remote, this.localUpdatedAt);

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel publish").onClick(() => this.finish("cancel")))
      .addButton((button) => button.setWarning().setButtonText("Overwrite remote").onClick(() => this.finish("overwrite")));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.finish("cancel");
  }

  private finish(value: ConflictDecision): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

class RemoteDeleteModal extends Modal {
  private resolved = false;

  constructor(app: App, private remote: WordPressPostResponse, private resolve: (value: DeleteDecision) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Remove WordPress post" });
    contentEl.createEl("p", { text: "Choose how to remove the remote WordPress post." });
    renderPostSummary(contentEl, this.remote);

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish("cancel")))
      .addButton((button) => button.setButtonText("Move to trash").onClick(() => this.finish("trash")))
      .addButton((button) => button.setWarning().setButtonText("Delete permanently").onClick(() => this.finish("delete")));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.finish("cancel");
  }

  private finish(value: DeleteDecision): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

function renderPostSummary(container: HTMLElement, remote: WordPressPostResponse, localUpdatedAt?: string): void {
  const list = container.createEl("dl");
  addRow(list, "ID", String(remote.id));
  addRow(list, "Status", remote.status);
  addRow(list, "URL", remote.link);
  addRow(list, "Published", remote.date);
  addRow(list, "Remote modified", remote.modified);
  if (localUpdatedAt) addRow(list, "Local last publish", localUpdatedAt);
}

function addRow(list: HTMLElement, label: string, value: string): void {
  list.createEl("dt", { text: label });
  list.createEl("dd", { text: value || "(empty)" });
}
