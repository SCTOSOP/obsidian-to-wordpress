import type { TFile } from "obsidian";

export interface WordPressPluginSettings {
  siteUrl: string;
  username: string;
  applicationPassword: string;
  applicationPasswordSaved: boolean;
  defaultStatus: WordPressPostStatus;
  debug: boolean;
  imageCompressionQuality: number;
  largeImageThresholdMb: number;
  imageStorageProvider: ImageStorageProviderId;
  aliyunOss: AliyunOssSettings;
  localApi: LocalApiSettings;
  encryptedSecrets: Record<string, string>;
  secretStoreStatus?: SecretStoreStatus;
  mediaCache: Record<string, MediaCacheEntry>;
}

export interface SecretStoreStatus {
  available: boolean;
  secure: boolean;
  backend: string;
  warning?: string;
}

export type ImageStorageProviderId = "wordpress" | "aliyun-oss";

export interface AliyunOssSettings {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  accessKeySecretSaved: boolean;
  publicBaseUrl: string;
  objectKeyRule: string;
  testReferer: string;
}

export interface LocalApiSettings {
  enabled: boolean;
  port: number;
  apiKeySaved: boolean;
  apiKeySalt: string;
  apiKeyHash: string;
  allowInteractive: boolean;
  allowDestructiveActions: boolean;
}

export interface MediaCacheEntry {
  vaultPath: string;
  size: number;
  mtime: number;
  compressionQuality: number;
  provider: ImageStorageProviderId;
  mediaId?: number;
  objectKey?: string;
  url: string;
  mimeType: string;
  uploadedFileName: string;
  uploadedAt: string;
}

export type WordPressPostStatus = "draft" | "publish" | "private" | "pending";

export interface WordPressFrontmatter {
  wp_post_id?: number;
  wp_url?: string;
  wp_published_at?: string;
  wp_updated_at?: string;
  wp_title?: string;
  wp_slug?: string;
  wp_status?: WordPressPostStatus;
  wp_excerpt?: string;
  wp_categories?: string[];
  wp_tags?: string[];
}

export interface PostMetadataInput {
  title: string;
  slug?: string;
  status: WordPressPostStatus;
  excerpt?: string;
  categories: string[];
  tags: string[];
}

export interface PublishContext {
  file: TFile;
  rawContent: string;
  markdownBody: string;
  metadata: WordPressFrontmatter;
  postInput: PostMetadataInput;
}

export interface WordPressPostPayload {
  title: string;
  content: string;
  status: WordPressPostStatus;
  slug?: string;
  excerpt?: string;
  categories?: number[];
  tags?: number[];
}

export interface WordPressPostResponse {
  id: number;
  link: string;
  date: string;
  modified: string;
  status: string;
  title?: { rendered?: string };
}

export interface WordPressDeleteResponse {
  deleted?: boolean;
  previous?: WordPressPostResponse;
  id?: number;
  status?: string;
}

export interface TaxonomyTermResponse {
  id: number;
  name: string;
  slug: string;
  parent?: number;
}

export interface WordPressMediaResponse {
  id: number;
  source_url: string;
  link: string;
  mime_type: string;
}

export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  dump(): string;
  clear(): void;
}

export interface PublishOptions {
  status?: WordPressPostStatus;
  overwriteRemoteChanges?: boolean;
  allowInteractive?: boolean;
  showNotice?: boolean;
  openBeforePublish?: boolean;
  source?: "command" | "api";
}

export interface PublishResult {
  postId: number;
  url: string;
  status: string;
  notePath: string;
  created: boolean;
  updated: boolean;
  publishedAt: string;
  modifiedAt: string;
}

export interface PublishedPostStatusItem {
  notePath: string;
  postId: number;
  localTitle?: string;
  localStatus?: WordPressPostStatus;
  localUrl?: string;
  localUpdatedAt?: string;
  remote?: PublishedPostRemoteSummary;
  error?: string;
}

export interface PublishedPostRemoteSummary {
  id: number;
  status: string;
  link: string;
  date: string;
  modified: string;
  title?: string;
  slug?: string;
  type?: string;
}

export type RuntimeWordPressPluginSettings = WordPressPluginSettings & {
  applicationPassword: string;
  aliyunOss: AliyunOssSettings & { accessKeySecret: string };
};
