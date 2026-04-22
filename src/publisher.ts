import { App, Notice, TFile } from "obsidian";
import { showErrorLogModal } from "./logger";
import { FrontmatterService, stripFrontmatter } from "./frontmatter";
import { WordPressImageAssetProcessor } from "./image-assets";
import { ObsidianMarkdownConverter } from "./markdown-converter";
import { MetadataModal } from "./metadata-modal";
import { confirmRemoteOverwrite } from "./remote-post-modals";
import { WordPressClient } from "./wordpress-client";
import type { Logger, PostMetadataInput, PublishOptions, PublishResult, WordPressPluginSettings, WordPressPostPayload } from "./types";

export class PublishService {
  private frontmatter: FrontmatterService;

  constructor(
    private app: App,
    private settings: WordPressPluginSettings,
    private logger: Logger,
    private persistSettings: () => Promise<void> = async () => undefined,
  ) {
    this.frontmatter = new FrontmatterService(app);
  }

  async publishCurrentNote(options: PublishOptions = {}): Promise<PublishResult | undefined> {
    this.assertSettingsReady();

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active note. Open a Markdown note before publishing.");
    }
    if (file.extension !== "md") {
      throw new Error("The active file is not a Markdown note.");
    }

    return this.publishFile(file, options);
  }

  async publishNoteByPath(path: string, options: PublishOptions = {}): Promise<PublishResult | undefined> {
    this.assertSettingsReady();

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`Markdown note not found: ${path}`);
    }
    if (file.extension !== "md") {
      throw new Error("The requested file is not a Markdown note.");
    }

    if (options.openBeforePublish) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }

    return this.publishFile(file, options);
  }

  private async publishFile(file: TFile, options: PublishOptions): Promise<PublishResult | undefined> {
    const metadata = this.frontmatter.read(file);
    if (!this.frontmatter.hasRequiredMapping(metadata)) {
      if (options.allowInteractive === false) {
        throw new Error("Missing required WordPress frontmatter: wp_title and wp_status are required. Enable interactive mode or add the fields before publishing.");
      }
      await this.collectInitialMetadata(file);
      return undefined;
    }

    return this.publishWithExistingMapping(file, options);
  }

  private async collectInitialMetadata(file: TFile): Promise<void> {
    const defaultTitle = file.basename;
    const categoryActions = await this.createCategoryActions();
    new MetadataModal(
      this.app,
      { title: defaultTitle, status: this.settings.defaultStatus },
      async (input) => {
        try {
          this.logger.info("Saving initial WordPress frontmatter mapping", input);
          await this.frontmatter.writeInitialMapping(file, input);
          await this.publish(file, input);
        } catch (error) {
          this.logger.error("Initial publish failed", serializeError(error));
          showErrorLogModal(this.app, "WordPress publish failed", this.logger, error);
        }
      },
      categoryActions,
    ).open();
  }

  private async createCategoryActions() {
    try {
      const client = new WordPressClient(this.settings, this.logger);
      const categories = await client.getCategories();
      return {
        categories,
        refresh: () => client.getCategories(),
        create: (name: string, parent?: number) => client.createCategory(name, parent),
        delete: async (categoryId: number) => {
          await client.deleteCategory(categoryId);
        },
      };
    } catch (error) {
      this.logger.warn("Could not load WordPress categories for publish modal", serializeError(error));
      return undefined;
    }
  }

  private async publishWithExistingMapping(file: TFile, options: PublishOptions): Promise<PublishResult> {
    const metadata = this.frontmatter.read(file);
    const input = this.frontmatter.buildInputFromFrontmatter(metadata);
    if (options.status) input.status = options.status;
    return this.publish(file, input, options);
  }

  private async publish(file: TFile, input: PostMetadataInput, options: PublishOptions = {}): Promise<PublishResult> {
    const rawContent = await this.app.vault.read(file);
    const markdownBody = stripFrontmatter(rawContent);
    const metadata = this.frontmatter.read(file);
    const client = new WordPressClient(this.settings, this.logger);
    await this.ensureRemoteCanBeOverwritten(client, metadata.wp_post_id, metadata.wp_updated_at, options);
    const imageProcessor = new WordPressImageAssetProcessor(
      this.app,
      client,
      this.settings,
      this.logger,
      this.persistSettings,
    );
    const markdownWithRemoteImages = await imageProcessor.rewriteMarkdownImages(markdownBody, file.path, input.title);
    const converter = new ObsidianMarkdownConverter(this.app, this.logger);
    const htmlBody = await converter.toHtml(markdownWithRemoteImages, file.path);

    this.logger.info("Preparing WordPress payload", { file: file.path, metadata: input });
    const [categoryIds, tagIds] = await Promise.all([
      client.resolveTerms("categories", input.categories),
      client.resolveTerms("tags", input.tags),
    ]);

    const payload: WordPressPostPayload = {
      title: input.title,
      content: htmlBody,
      status: input.status,
      slug: input.slug,
      excerpt: input.excerpt,
      categories: categoryIds.length > 0 ? categoryIds : undefined,
      tags: tagIds.length > 0 ? tagIds : undefined,
    };

    const response = await client.createOrUpdatePost(metadata.wp_post_id, payload);
    await this.frontmatter.writePublishResult(file, response);

    if (options.showNotice !== false) {
      new Notice(`Published to WordPress: ${response.link}`, 8000);
    }
    this.logger.info("Publish completed", response);
    return {
      postId: response.id,
      url: response.link,
      status: response.status,
      notePath: file.path,
      created: !metadata.wp_post_id,
      updated: Boolean(metadata.wp_post_id),
      publishedAt: response.date,
      modifiedAt: response.modified,
    };
  }

  private async ensureRemoteCanBeOverwritten(
    client: WordPressClient,
    postId: number | undefined,
    localUpdatedAt: string | undefined,
    options: PublishOptions,
  ): Promise<void> {
    if (!postId || !localUpdatedAt) return;

    const remote = await client.getPost(postId);
    this.logger.info("Checked remote post before overwrite", { postId, localUpdatedAt, remoteModified: remote.modified });
    if (sameTimestamp(remote.modified, localUpdatedAt)) return;

    if (options.overwriteRemoteChanges) {
      this.logger.warn("Overwriting remotely modified WordPress post because overwriteRemoteChanges is enabled", { postId });
      return;
    }

    if (options.allowInteractive === false) {
      throw new Error("Remote WordPress post has changed since the last publish. Set overwriteRemoteChanges=true to overwrite it.");
    }

    const decision = await confirmRemoteOverwrite(this.app, remote, localUpdatedAt);
    if (decision !== "overwrite") {
      throw new Error("Publish canceled because the remote WordPress post has changed.");
    }
  }

  private assertSettingsReady(): void {
    const missing = [];
    if (!this.settings.siteUrl) missing.push("site URL");
    if (!this.settings.username) missing.push("username");
    if (!this.settings.applicationPassword) missing.push("application password");

    if (missing.length > 0) {
      throw new Error(`WordPress settings incomplete: ${missing.join(", ")}.`);
    }
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function sameTimestamp(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return Math.abs(leftTime - rightTime) < 1000;
  }
  return left === right;
}
