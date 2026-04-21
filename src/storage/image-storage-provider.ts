import type { Logger, WordPressPluginSettings } from "../types";
import { WordPressClient } from "../wordpress-client";
import { AliyunOssStorageProvider } from "./aliyun-oss-provider";
import { WordPressMediaStorageProvider } from "./wordpress-media-provider";

export interface ImageUploadInput {
  vaultPath: string;
  postTitle: string;
  fileName: string;
  mimeType: string;
  body: ArrayBuffer;
  originalSize: number;
  uploadSize: number;
  compressed: boolean;
}

export interface ImageUploadResult {
  provider: WordPressPluginSettings["imageStorageProvider"];
  url: string;
  mediaId?: number;
  objectKey?: string;
  uploadedFileName: string;
  mimeType: string;
}

export interface ImageStorageProvider {
  readonly id: WordPressPluginSettings["imageStorageProvider"];
  uploadImage(input: ImageUploadInput): Promise<ImageUploadResult>;
}

export function createImageStorageProvider(
  settings: WordPressPluginSettings,
  wordpressClient: WordPressClient | undefined,
  logger: Logger,
): ImageStorageProvider {
  if (settings.imageStorageProvider === "aliyun-oss") {
    return new AliyunOssStorageProvider(settings.aliyunOss, logger);
  }

  if (!wordpressClient) {
    throw new Error("WordPress media storage requires a WordPress client.");
  }
  return new WordPressMediaStorageProvider(wordpressClient);
}

export function createTestImageUploadInput(objectKeyRule: string): ImageUploadInput {
  return {
    vaultPath: "oss-test-image.png",
    postTitle: "oss-test",
    fileName: "oss-test-image.png",
    mimeType: "image/png",
    body: base64ToArrayBuffer("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lEao0wAAAABJRU5ErkJggg=="),
    originalSize: 70,
    uploadSize: 70,
    compressed: false,
  };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
