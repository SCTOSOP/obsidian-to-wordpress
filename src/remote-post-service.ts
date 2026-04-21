import { App, Notice, TFile } from "obsidian";
import { FrontmatterService } from "./frontmatter";
import { confirmRemoteDelete, RemoteStatusModal } from "./remote-post-modals";
import type { Logger, WordPressPluginSettings } from "./types";
import { WordPressClient } from "./wordpress-client";

export class RemotePostService {
  private frontmatter: FrontmatterService;

  constructor(private app: App, private settings: WordPressPluginSettings, private logger: Logger) {
    this.frontmatter = new FrontmatterService(app);
  }

  async showCurrentRemoteStatus(): Promise<void> {
    const { file, postId } = this.getActiveMappedPost();
    const client = new WordPressClient(this.settings, this.logger);
    const remote = await client.getPost(postId);
    this.logger.info("Fetched remote WordPress post status", { file: file.path, remote });
    new RemoteStatusModal(this.app, remote).open();
  }

  async unpublishCurrentPost(): Promise<void> {
    const { file, postId } = this.getActiveMappedPost();
    const client = new WordPressClient(this.settings, this.logger);
    const response = await client.updatePostStatus(postId, "draft");
    await this.frontmatter.writePublishResult(file, response);
    this.logger.info("Unpublished remote WordPress post", response);
    new Notice(`Moved WordPress post to draft: ${response.link}`, 8000);
  }

  async deleteCurrentRemotePost(): Promise<void> {
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
    new Notice(decision === "delete" ? "WordPress post deleted permanently." : "WordPress post moved to trash.", 8000);
  }

  private getActiveMappedPost(): { file: TFile; postId: number } {
    const file = this.app.workspace.getActiveFile();
    if (!file) throw new Error("No active note. Open a published Markdown note first.");
    if (file.extension !== "md") throw new Error("The active file is not a Markdown note.");

    const metadata = this.frontmatter.read(file);
    if (!metadata.wp_post_id) {
      throw new Error("This note does not have wp_post_id in frontmatter. Publish it before using remote post actions.");
    }

    return { file, postId: metadata.wp_post_id };
  }
}
