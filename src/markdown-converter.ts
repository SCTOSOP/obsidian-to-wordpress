import { App, Component, MarkdownRenderer } from "obsidian";
import { ObsidianSpecialFormatTransformer } from "./special-formats";
import type { Logger } from "./types";

export interface MarkdownConverter {
  toHtml(markdown: string, sourcePath: string): Promise<string>;
}

export class ObsidianMarkdownConverter implements MarkdownConverter {
  constructor(private app: App, private logger: Logger) {}

  async toHtml(markdown: string, sourcePath: string): Promise<string> {
    this.logger.info("Rendering Obsidian Markdown to HTML", { sourcePath });

    const transformer = new ObsidianSpecialFormatTransformer(this.logger);
    const renderableMarkdown = transformer.beforeRender(markdown);
    const container = document.createElement("div");
    const component = new Component();

    try {
      await MarkdownRenderer.render(this.app, renderableMarkdown, container, sourcePath, component);
      return transformer.afterRender(container.innerHTML);
    } finally {
      component.unload();
    }
  }
}
