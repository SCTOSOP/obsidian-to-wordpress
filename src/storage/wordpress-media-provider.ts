import type { ImageStorageProvider, ImageUploadInput, ImageUploadResult } from "./image-storage-provider";
import { WordPressClient } from "../wordpress-client";

export class WordPressMediaStorageProvider implements ImageStorageProvider {
  readonly id = "wordpress" as const;

  constructor(private client: WordPressClient) {}

  async uploadImage(input: ImageUploadInput): Promise<ImageUploadResult> {
    const response = await this.client.uploadMedia(input.fileName, input.mimeType, input.body);
    return {
      provider: this.id,
      url: response.source_url || response.link,
      mediaId: response.id,
      uploadedFileName: input.fileName,
      mimeType: input.mimeType,
    };
  }
}
