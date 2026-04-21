import { requestUrl } from "obsidian";
import type {
  Logger,
  TaxonomyTermResponse,
  WordPressDeleteResponse,
  WordPressMediaResponse,
  WordPressPluginSettings,
  WordPressPostPayload,
  WordPressPostResponse,
} from "./types";

export class WordPressClient {
  constructor(private settings: WordPressPluginSettings, private logger: Logger) {}

  async getPost(postId: number): Promise<WordPressPostResponse> {
    this.logger.info("Fetching WordPress post", { postId });
    return this.request<WordPressPostResponse>(`/wp-json/wp/v2/posts/${postId}?context=edit`, "GET");
  }

  async createOrUpdatePost(postId: number | undefined, payload: WordPressPostPayload): Promise<WordPressPostResponse> {
    const endpoint = postId ? `/wp-json/wp/v2/posts/${postId}` : "/wp-json/wp/v2/posts";
    this.logger.info(postId ? "Updating WordPress post" : "Creating WordPress post", { endpoint, payload });
    return this.request<WordPressPostResponse>(endpoint, "POST", payload);
  }

  async updatePostStatus(postId: number, status: WordPressPostPayload["status"]): Promise<WordPressPostResponse> {
    this.logger.info("Updating WordPress post status", { postId, status });
    return this.request<WordPressPostResponse>(`/wp-json/wp/v2/posts/${postId}`, "POST", { status });
  }

  async deletePost(postId: number, force: boolean): Promise<WordPressDeleteResponse> {
    this.logger.info(force ? "Deleting WordPress post permanently" : "Moving WordPress post to trash", { postId });
    return this.request<WordPressDeleteResponse>(`/wp-json/wp/v2/posts/${postId}?force=${force ? "true" : "false"}`, "DELETE");
  }

  async uploadMedia(fileName: string, mimeType: string, body: ArrayBuffer): Promise<WordPressMediaResponse> {
    this.logger.info("Uploading WordPress media", { fileName, mimeType, bytes: body.byteLength });
    return this.requestBinary<WordPressMediaResponse>("/wp-json/wp/v2/media", "POST", body, {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${escapeHeaderValue(fileName)}"`,
    });
  }

  async getCategories(): Promise<TaxonomyTermResponse[]> {
    this.logger.info("Fetching WordPress categories");
    return this.request<TaxonomyTermResponse[]>("/wp-json/wp/v2/categories?per_page=100&hide_empty=false", "GET");
  }

  async createCategory(name: string, parent?: number): Promise<TaxonomyTermResponse> {
    this.logger.info("Creating WordPress category", { name, parent });
    return this.request<TaxonomyTermResponse>("/wp-json/wp/v2/categories", "POST", {
      name,
      ...(parent ? { parent } : {}),
    });
  }

  async deleteCategory(categoryId: number): Promise<WordPressDeleteResponse> {
    this.logger.info("Deleting WordPress category", { categoryId });
    return this.request<WordPressDeleteResponse>(`/wp-json/wp/v2/categories/${categoryId}?force=true`, "DELETE");
  }

  async resolveTerms(taxonomy: "categories" | "tags", names: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of names) {
      const existing = await this.findTerm(taxonomy, name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await this.createTerm(taxonomy, name);
      ids.push(created.id);
    }
    return ids;
  }

  private async findTerm(taxonomy: "categories" | "tags", name: string): Promise<TaxonomyTermResponse | undefined> {
    this.logger.info("Looking up WordPress taxonomy term", { taxonomy, name });
    const terms = await this.request<TaxonomyTermResponse[]>(`/wp-json/wp/v2/${taxonomy}?search=${encodeURIComponent(name)}`, "GET");
    return terms.find((term) => term.name.toLowerCase() === name.toLowerCase());
  }

  private async createTerm(taxonomy: "categories" | "tags", name: string): Promise<TaxonomyTermResponse> {
    this.logger.info("Creating WordPress taxonomy term", { taxonomy, name });
    return this.request<TaxonomyTermResponse>(`/wp-json/wp/v2/${taxonomy}`, "POST", { name });
  }

  private async requestBinary<T>(
    path: string,
    method: "POST",
    body: ArrayBuffer,
    extraHeaders: Record<string, string>,
  ): Promise<T> {
    return this.requestRaw<T>(path, method, body, extraHeaders);
  }

  private async request<T>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    let requestBody: string | undefined;

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    return this.requestRaw<T>(path, method, requestBody, headers);
  }

  private async requestRaw<T>(
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: string | ArrayBuffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const siteUrl = this.settings.siteUrl.replace(/\/$/, "");
    const url = `${siteUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${this.settings.username}:${this.settings.applicationPassword}`)}`,
      ...extraHeaders,
    };

    const response = await requestUrl({
      url,
      method,
      headers,
      body,
      throw: false,
    });

    this.logger.info("WordPress REST response", {
      url,
      method,
      status: response.status,
      headers,
      body: response.json ?? response.text,
    });

    if (response.status < 200 || response.status >= 300) {
      const errorText = typeof response.text === "string" ? response.text : JSON.stringify(response.json);
      throw new Error(`WordPress REST request failed: ${response.status} ${errorText}`);
    }

    return response.json as T;
  }
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, "_");
}
