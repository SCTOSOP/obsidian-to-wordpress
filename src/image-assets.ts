import { App, TFile } from "obsidian";
import { confirmEndpointSwitch } from "./endpoint-switch-modal";
import { BrowserImageCompressor } from "./image-compressor";
import { HttpMediaUrlChecker } from "./media-url-checker";
import { createImageStorageProvider, type ImageStorageProvider } from "./storage/image-storage-provider";
import { AliyunOssEndpointMismatchError } from "./storage/aliyun-oss-provider";
import { confirmLargeImageUpload } from "./upload-confirm-modal";
import type { MediaCacheStore } from "./media-cache-store";
import type { Logger, MediaCacheEntry, WordPressPluginSettings } from "./types";
import { WordPressClient } from "./wordpress-client";

export interface ImageAssetProcessor {
  rewriteMarkdownImages(markdown: string, sourcePath: string, postTitle: string): Promise<string>;
}

interface UploadedImage {
  url: string;
  alt: string;
}

export class WordPressImageAssetProcessor implements ImageAssetProcessor {
  private uploadedByPath = new Map<string, UploadedImage>();
  private compressor: BrowserImageCompressor;
  private mediaUrlChecker: HttpMediaUrlChecker;
  private storageProvider: ImageStorageProvider;
  private currentPostTitle = "untitled";

  constructor(
    private app: App,
    private client: WordPressClient,
    private settings: WordPressPluginSettings,
    private logger: Logger,
    private mediaCacheStore: MediaCacheStore,
    private persistSettings: () => Promise<void>,
  ) {
    this.compressor = new BrowserImageCompressor(logger);
    this.mediaUrlChecker = new HttpMediaUrlChecker(logger);
    this.storageProvider = createImageStorageProvider(settings, client, logger);
  }

  async rewriteMarkdownImages(markdown: string, sourcePath: string, postTitle: string): Promise<string> {
    this.currentPostTitle = postTitle || "untitled";
    this.logger.info("Rewriting local Markdown images for WordPress", { sourcePath, postTitle: this.currentPostTitle });

    const chunks = splitByFencedCodeBlocks(markdown);
    const rewritten: string[] = [];
    for (const chunk of chunks) {
      if (chunk.kind === "fence" && !isAdmonitionFence(chunk.text)) {
        rewritten.push(chunk.text);
        continue;
      }

      rewritten.push(await this.rewriteImageReferences(chunk.text, sourcePath));
    }
    return rewritten.join("");
  }

  private async rewriteImageReferences(markdown: string, sourcePath: string): Promise<string> {
    const withObsidianEmbeds = await replaceAsync(
      markdown,
      /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      async (_match, rawTarget: string, rawAlias: string | undefined) => {
        const file = this.resolveLocalImage(rawTarget, sourcePath);
        if (!file) {
          this.logger.warn("Could not resolve Obsidian image embed", { target: rawTarget, sourcePath });
          return _match;
        }

        const uploaded = await this.uploadImage(file, normalizeAlt(rawAlias, file));
        return `![${escapeMarkdownAlt(uploaded.alt)}](${uploaded.url})`;
      },
    );

    return replaceAsync(
      withObsidianEmbeds,
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      async (_match, rawAlt: string, rawTarget: string) => {
        const parsed = parseMarkdownImageTarget(rawTarget);
        if (!parsed || isRemoteOrDataUrl(parsed.path)) return _match;

        const file = this.resolveLocalImage(parsed.path, sourcePath);
        if (!file) {
          this.logger.warn("Could not resolve Markdown image", { target: parsed.path, sourcePath });
          return _match;
        }

        const uploaded = await this.uploadImage(file, rawAlt.trim() || file.basename);
        return `![${escapeMarkdownAlt(uploaded.alt)}](${uploaded.url}${parsed.title ? ` ${parsed.title}` : ""})`;
      },
    );
  }

  private resolveLocalImage(target: string, sourcePath: string): TFile | null {
    const decodedTarget = safeDecodeUri(stripAngleBrackets(target.trim()));
    const file = this.app.metadataCache.getFirstLinkpathDest(decodedTarget, sourcePath);
    if (!file || !isImageExtension(file.extension)) return null;
    return file;
  }

  private async uploadImage(file: TFile, alt: string): Promise<UploadedImage> {
    const cached = this.uploadedByPath.get(file.path);
    if (cached) {
      this.logger.info("Reusing uploaded image in current publish", { path: file.path, url: cached.url });
      return cached;
    }

    const persistentCache = await this.getValidPersistentCache(file);
    if (persistentCache) {
      const remoteStatus = await this.mediaUrlChecker.check(persistentCache.url);
      if (remoteStatus === "available" || remoteStatus === "unknown") {
        const uploaded = { url: persistentCache.url, alt };
        this.uploadedByPath.set(file.path, uploaded);
        this.logger.info("Reusing persisted media URL", {
          path: file.path,
          url: persistentCache.url,
          mediaId: persistentCache.mediaId,
          objectKey: persistentCache.objectKey,
          provider: persistentCache.provider,
          remoteStatus,
        });
        return uploaded;
      }

      this.logger.warn("Cached media URL is missing; image will be re-uploaded", {
        path: file.path,
        url: persistentCache.url,
        mediaId: persistentCache.mediaId,
        objectKey: persistentCache.objectKey,
        provider: persistentCache.provider,
      });
      await this.mediaCacheStore.delete(file.path);
    }

    const mimeType = getImageMimeType(file.extension);
    const originalBody = await this.app.vault.readBinary(file);
    const prepared = await this.compressor.prepare(
      file,
      originalBody,
      mimeType,
      this.settings.imageCompressionQuality,
    );

    const thresholdBytes = this.settings.largeImageThresholdMb * 1024 * 1024;
    if (thresholdBytes > 0 && prepared.uploadBytes > thresholdBytes) {
      const shouldUpload = await confirmLargeImageUpload(this.app, {
        fileName: prepared.fileName,
        originalBytes: prepared.originalBytes,
        uploadBytes: prepared.uploadBytes,
        thresholdBytes,
        compressed: prepared.compressed,
      });

      if (!shouldUpload) {
        throw new Error(`Image upload canceled: ${file.path}`);
      }
    }

    const uploadInput = {
      vaultPath: file.path,
      postTitle: this.currentPostTitle,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      body: prepared.body,
      originalSize: prepared.originalBytes,
      uploadSize: prepared.uploadBytes,
      compressed: prepared.compressed,
    };
    const response = await this.uploadWithEndpointMismatchRecovery(uploadInput);
    const uploaded = { url: response.url, alt };
    this.uploadedByPath.set(file.path, uploaded);
    await this.writePersistentCache(file, {
      vaultPath: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      compressionQuality: this.settings.imageCompressionQuality,
      provider: response.provider,
      mediaId: response.mediaId,
      objectKey: response.objectKey,
      url: uploaded.url,
      mimeType: response.mimeType,
      uploadedFileName: response.uploadedFileName,
      uploadedAt: new Date().toISOString(),
    });
    this.logger.info("Uploaded image to WordPress", {
      path: file.path,
      url: uploaded.url,
      mediaId: response.mediaId,
      objectKey: response.objectKey,
      provider: response.provider,
      originalBytes: prepared.originalBytes,
      uploadBytes: prepared.uploadBytes,
      compressed: prepared.compressed,
    });
    return uploaded;
  }

  private async uploadWithEndpointMismatchRecovery(
    uploadInput: Parameters<ImageStorageProvider["uploadImage"]>[0],
  ) {
    try {
      return await this.storageProvider.uploadImage(uploadInput);
    } catch (error) {
      if (!(error instanceof AliyunOssEndpointMismatchError)) throw error;

      const shouldSwitch = await confirmEndpointSwitch(this.app, error.currentEndpoint, error.recommendedEndpoint);
      if (!shouldSwitch) throw error;

      this.settings.aliyunOss.endpoint = error.recommendedEndpoint;
      await this.persistSettings();
      this.storageProvider = createImageStorageProvider(this.settings, this.client, this.logger);
      this.logger.info("Retrying image upload after OSS endpoint switch", {
        recommendedEndpoint: error.recommendedEndpoint,
      });
      return this.storageProvider.uploadImage(uploadInput);
    }
  }

  private async getValidPersistentCache(file: TFile): Promise<MediaCacheEntry | undefined> {
    const entry = await this.mediaCacheStore.get(file.path);
    if (!entry) return undefined;
    if (entry.vaultPath !== file.path) return undefined;
    if (entry.size !== file.stat.size) return undefined;
    if (entry.mtime !== file.stat.mtime) return undefined;
    if (entry.compressionQuality !== this.settings.imageCompressionQuality) return undefined;
    if (entry.provider !== this.settings.imageStorageProvider) return undefined;
    if (!entry.url) return undefined;
    return entry;
  }

  private async writePersistentCache(file: TFile, entry: MediaCacheEntry): Promise<void> {
    await this.mediaCacheStore.set(entry);
  }
}

interface MarkdownChunk {
  kind: "text" | "fence";
  text: string;
}

function splitByFencedCodeBlocks(markdown: string): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  const fenceRegex = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const fenceStart = match.index + match[1].length;
    if (fenceStart > lastIndex) {
      chunks.push({ kind: "text", text: markdown.slice(lastIndex, fenceStart) });
    }
    chunks.push({ kind: "fence", text: markdown.slice(fenceStart, fenceRegex.lastIndex) });
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    chunks.push({ kind: "text", text: markdown.slice(lastIndex) });
  }

  return chunks;
}

async function replaceAsync(
  value: string,
  regex: RegExp,
  replacer: (...args: string[]) => Promise<string>,
): Promise<string> {
  const matches = Array.from(value.matchAll(regex));
  if (matches.length === 0) return value;

  let output = "";
  let lastIndex = 0;
  for (const match of matches) {
    output += value.slice(lastIndex, match.index);
    output += await replacer(...(match as unknown as string[]));
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  output += value.slice(lastIndex);
  return output;
}

function isAdmonitionFence(fence: string): boolean {
  const match = fence.match(/^(```|~~~)([^\n]*)\n/);
  const language = match?.[2].trim().split(/\s+/)[0]?.toLowerCase();
  return Boolean(language?.startsWith("ad-"));
}

function parseMarkdownImageTarget(rawTarget: string): { path: string; title?: string } | null {
  const target = rawTarget.trim();
  if (!target) return null;

  const angleMatch = target.match(/^<([^>]+)>(.*)$/);
  if (angleMatch) {
    const title = angleMatch[2].trim();
    return { path: angleMatch[1], title: title || undefined };
  }

  const titleMatch = target.match(/^(.*?)(\s+["'][^"']+["'])$/);
  if (titleMatch) {
    return { path: titleMatch[1].trim(), title: titleMatch[2].trim() };
  }

  return { path: target };
}

function normalizeAlt(rawAlias: string | undefined, file: TFile): string {
  const alias = rawAlias?.trim();
  if (!alias) return file.basename;
  if (/^\d+(x\d+)?$/.test(alias)) return file.basename;
  return alias;
}

function isRemoteOrDataUrl(value: string): boolean {
  return /^(https?:|data:|app:|file:|mailto:)/i.test(value);
}

function isImageExtension(extension: string): boolean {
  return ["apng", "avif", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extension.toLowerCase());
}

function getImageMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    apng: "image/apng",
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return mimeTypes[extension.toLowerCase()] ?? "application/octet-stream";
}

function stripAngleBrackets(value: string): string {
  return value.replace(/^<(.+)>$/, "$1");
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/[\[\]\\]/g, "\\$&");
}
