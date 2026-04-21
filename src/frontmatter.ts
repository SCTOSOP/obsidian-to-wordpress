import { App, TFile } from "obsidian";
import type { PostMetadataInput, WordPressFrontmatter, WordPressPostResponse } from "./types";

export class FrontmatterService {
  constructor(private app: App) {}

  read(file: TFile): WordPressFrontmatter {
    const cache = this.app.metadataCache.getFileCache(file);
    return { ...(cache?.frontmatter ?? {}) } as WordPressFrontmatter;
  }

  hasRequiredMapping(metadata: WordPressFrontmatter): boolean {
    return Boolean(metadata.wp_title && metadata.wp_status);
  }

  async writeInitialMapping(file: TFile, input: PostMetadataInput): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.wp_title = input.title;
      frontmatter.wp_slug = input.slug ?? "";
      frontmatter.wp_status = input.status;
      frontmatter.wp_excerpt = input.excerpt ?? "";
      frontmatter.wp_categories = input.categories;
      frontmatter.wp_tags = input.tags;
    });
  }

  async writePublishResult(file: TFile, response: WordPressPostResponse): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.wp_post_id = response.id;
      frontmatter.wp_url = response.link;
      frontmatter.wp_published_at = response.date;
      frontmatter.wp_updated_at = response.modified;
    });
  }

  async writePostStatus(file: TFile, status: PostMetadataInput["status"]): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.wp_status = status;
    });
  }

  async clearPublishResult(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.wp_post_id;
      delete frontmatter.wp_url;
      delete frontmatter.wp_published_at;
      delete frontmatter.wp_updated_at;
    });
  }

  async clearWordPressMapping(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.wp_post_id;
      delete frontmatter.wp_url;
      delete frontmatter.wp_published_at;
      delete frontmatter.wp_updated_at;
      delete frontmatter.wp_title;
      delete frontmatter.wp_slug;
      delete frontmatter.wp_status;
      delete frontmatter.wp_excerpt;
      delete frontmatter.wp_categories;
      delete frontmatter.wp_tags;
    });
  }

  buildInputFromFrontmatter(metadata: WordPressFrontmatter): PostMetadataInput {
    if (!metadata.wp_title || !metadata.wp_status) {
      throw new Error("Missing required WordPress frontmatter: wp_title and wp_status are required.");
    }

    return {
      title: metadata.wp_title,
      slug: emptyToUndefined(metadata.wp_slug),
      status: metadata.wp_status,
      excerpt: emptyToUndefined(metadata.wp_excerpt),
      categories: normalizeStringList(metadata.wp_categories),
      tags: normalizeStringList(metadata.wp_tags),
    };
  }
}

export function stripFrontmatter(rawContent: string): string {
  if (!rawContent.startsWith("---\n")) {
    return rawContent;
  }

  const end = rawContent.indexOf("\n---", 4);
  if (end === -1) {
    return rawContent;
  }

  return rawContent.slice(end + "\n---".length).replace(/^\n/, "");
}

export function normalizeStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function emptyToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
