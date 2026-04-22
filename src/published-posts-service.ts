import { App, TFile } from "obsidian";
import { FrontmatterService } from "./frontmatter";
import type { Logger, PublishedPostStatusItem, PublishedPostRemoteSummary, WordPressPluginSettings, WordPressPostResponse } from "./types";
import { WordPressClient } from "./wordpress-client";

export class PublishedPostsService {
  private frontmatter: FrontmatterService;

  constructor(private app: App, private settings: WordPressPluginSettings, private logger: Logger) {
    this.frontmatter = new FrontmatterService(app);
  }

  async listPublishedPosts(): Promise<PublishedPostStatusItem[]> {
    const files = this.app.vault.getMarkdownFiles();
    const client = new WordPressClient(this.settings, this.logger);
    const results: PublishedPostStatusItem[] = [];

    for (const file of files) {
      const item = await this.buildStatusItem(file, client);
      if (item) results.push(item);
    }

    this.logger.info("Listed published Obsidian WordPress posts", { count: results.length });
    return results;
  }

  private async buildStatusItem(file: TFile, client: WordPressClient): Promise<PublishedPostStatusItem | undefined> {
    const metadata = this.frontmatter.read(file);
    if (!metadata.wp_post_id) return undefined;

    const item: PublishedPostStatusItem = {
      notePath: file.path,
      postId: metadata.wp_post_id,
      localTitle: metadata.wp_title,
      localStatus: metadata.wp_status,
      localUrl: metadata.wp_url,
      localUpdatedAt: metadata.wp_updated_at,
    };

    try {
      item.remote = summarizeRemotePost(await client.getPost(metadata.wp_post_id));
    } catch (error) {
      item.error = error instanceof Error ? error.message : "Failed to fetch remote post status";
      this.logger.warn("Failed to fetch remote status for published note", { file: file.path, postId: metadata.wp_post_id, error: item.error });
    }

    return item;
  }
}

function summarizeRemotePost(remote: WordPressPostResponse & { slug?: string; type?: string }): PublishedPostRemoteSummary {
  return {
    id: remote.id,
    status: remote.status,
    link: remote.link,
    date: remote.date,
    modified: remote.modified,
    title: remote.title?.rendered,
    slug: remote.slug,
    type: remote.type,
  };
}
