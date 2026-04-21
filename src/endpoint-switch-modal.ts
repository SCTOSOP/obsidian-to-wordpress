import { App, Modal, Setting } from "obsidian";

export function confirmEndpointSwitch(app: App, currentEndpoint: string, recommendedEndpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    new EndpointSwitchModal(app, currentEndpoint, recommendedEndpoint, resolve).open();
  });
}

class EndpointSwitchModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private currentEndpoint: string,
    private recommendedEndpoint: string,
    private resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "OSS endpoint mismatch" });
    contentEl.createEl("p", {
      text: "Aliyun says this bucket must be accessed through a different endpoint.",
    });
    contentEl.createEl("p", { text: `Current: ${this.currentEndpoint || "(empty)"}` });
    contentEl.createEl("p", { text: `Recommended: ${this.recommendedEndpoint}` });

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Keep current")
        .onClick(() => this.finish(false)))
      .addButton((button) => button
        .setCta()
        .setButtonText("Switch endpoint")
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
