import { requestUrl } from "obsidian";
import type { AliyunOssSettings, Logger } from "../types";
import type { ImageStorageProvider, ImageUploadInput, ImageUploadResult } from "./image-storage-provider";
import { buildObjectKey } from "./object-key-builder";

export class AliyunOssStorageProvider implements ImageStorageProvider {
  readonly id = "aliyun-oss" as const;

  constructor(private settings: AliyunOssSettings, private logger: Logger) {}

  async uploadImage(input: ImageUploadInput): Promise<ImageUploadResult> {
    this.assertReady();
    const objectKey = await buildObjectKey(this.settings.objectKeyRule, input);
    const date = new Date().toUTCString();
    const resource = `/${this.settings.bucket}/${objectKey}`;
    const signature = await signOssV1("PUT", input.mimeType, date, resource, this.settings.accessKeySecret);
    const encodedObjectKey = encodeObjectKeyPath(objectKey);
    const url = `${this.uploadBaseUrl()}/${encodedObjectKey}`;

    this.logger.info("Uploading image to Aliyun OSS", {
      bucket: this.settings.bucket,
      endpoint: this.settings.endpoint,
      objectKey,
      mimeType: input.mimeType,
      bytes: input.body.byteLength,
    });

    const response = await requestUrl({
      url,
      method: "PUT",
      headers: {
        Authorization: `OSS ${this.settings.accessKeyId}:${signature}`,
        Date: date,
        "Content-Type": input.mimeType,
      },
      body: input.body,
      throw: false,
    });

    this.logger.info("Aliyun OSS PUT response", { status: response.status, text: response.text });
    if (response.status < 200 || response.status >= 300) {
      throw buildOssUploadError(response.status, response.text, this.settings);
    }

    return {
      provider: this.id,
      url: `${this.publicBaseUrl()}/${encodedObjectKey}`,
      objectKey,
      uploadedFileName: input.fileName,
      mimeType: input.mimeType,
    };
  }

  private assertReady(): void {
    const missing: string[] = [];
    if (!this.settings.endpoint) missing.push("OSS endpoint");
    if (!this.settings.bucket) missing.push("OSS bucket");
    if (!this.settings.accessKeyId) missing.push("AccessKey ID");
    if (!this.settings.accessKeySecret) missing.push("AccessKey Secret");
    if (!this.settings.publicBaseUrl) missing.push("Public base URL");
    if (missing.length > 0) throw new Error(`Aliyun OSS settings incomplete: ${missing.join(", ")}.`);
  }

  private uploadBaseUrl(): string {
    const endpoint = trimTrailingSlash(this.settings.endpoint);
    const host = endpoint.replace(/^https?:\/\//, "");
    if (host.startsWith(`${this.settings.bucket}.`)) return endpoint;
    const protocol = endpoint.startsWith("http://") ? "http://" : "https://";
    return `${protocol}${this.settings.bucket}.${host}`;
  }

  private publicBaseUrl(): string {
    return normalizePublicBaseUrl(this.settings.publicBaseUrl, this.logger);
  }
}

async function signOssV1(
  method: string,
  contentType: string,
  date: string,
  canonicalizedResource: string,
  accessKeySecret: string,
): Promise<string> {
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${canonicalizedResource}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(accessKeySecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  return arrayBufferToBase64(signature);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePublicBaseUrl(value: string, logger: Logger): string {
  try {
    const url = new URL(value);
    if (url.search || url.hash) {
      logger.warn("OSS public base URL contains query or hash; stripping it before inserting image URLs", {
        original: value,
        stripped: `${url.origin}${url.pathname}`,
      });
      url.search = "";
      url.hash = "";
    }
    return trimTrailingSlash(url.toString());
  } catch (_error) {
    return trimTrailingSlash(value.split(/[?#]/)[0]);
  }
}

function encodeObjectKeyPath(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

interface ParsedOssError {
  code?: string;
  message?: string;
  requestId?: string;
  hostId?: string;
  bucket?: string;
  endpoint?: string;
  ec?: string;
}

export class AliyunOssEndpointMismatchError extends Error {
  constructor(
    message: string,
    readonly currentEndpoint: string,
    readonly recommendedEndpoint: string,
  ) {
    super(message);
    this.name = "AliyunOssEndpointMismatchError";
  }
}

function buildOssUploadError(status: number, rawText: string, settings: AliyunOssSettings): Error {
  const parsed = parseOssError(rawText);
  const message = buildFriendlyOssError(status, rawText, settings, parsed);
  if (parsed.endpoint && /specified endpoint/i.test(parsed.message ?? "")) {
    return new AliyunOssEndpointMismatchError(message, settings.endpoint, `https://${parsed.endpoint}`);
  }
  return new Error(message);
}

function buildFriendlyOssError(
  status: number,
  rawText: string,
  settings: AliyunOssSettings,
  parsed = parseOssError(rawText),
): string {
  const summary = explainOssError(status, parsed, settings);
  const details = [
    `HTTP status: ${status}`,
    parsed.code ? `OSS code: ${parsed.code}` : undefined,
    parsed.message ? `OSS message: ${parsed.message}` : undefined,
    parsed.endpoint ? `Suggested endpoint: https://${parsed.endpoint}` : undefined,
    parsed.bucket ? `Bucket: ${parsed.bucket}` : undefined,
    parsed.requestId ? `RequestId: ${parsed.requestId}` : undefined,
    parsed.ec ? `EC: ${parsed.ec}` : undefined,
  ].filter(Boolean).join("\n");

  return `Aliyun OSS upload failed. ${summary}\n\n${details}`;
}

function explainOssError(status: number, parsed: ParsedOssError, settings: AliyunOssSettings): string {
  if (parsed.endpoint && /specified endpoint/i.test(parsed.message ?? "")) {
    return `The bucket is in a different region than your configured endpoint. Change OSS endpoint from ${settings.endpoint || "(empty)"} to https://${parsed.endpoint}.`;
  }

  if (parsed.code === "SignatureDoesNotMatch") {
    return "The OSS request signature did not match. This is usually caused by a wrong AccessKey Secret, wrong bucket/endpoint, system time drift, or an object-key signing mismatch.";
  }

  if (parsed.code === "InvalidAccessKeyId") {
    return "The AccessKey ID is invalid or disabled. Check the configured AccessKey ID.";
  }

  if (parsed.code === "AccessDenied") {
    return "OSS denied this upload. Check bucket permissions, RAM policy, endpoint region, and whether this AccessKey can put objects into the bucket.";
  }

  if (parsed.code === "NoSuchBucket") {
    return "The bucket does not exist or is not accessible from the configured endpoint. Check bucket name and region.";
  }

  if (parsed.code === "InvalidBucketName") {
    return "The configured bucket name is invalid. Check the OSS bucket setting.";
  }

  if (status === 403) {
    return "OSS returned 403 Forbidden. This is usually caused by wrong credentials, missing RAM permissions, wrong endpoint region, or bucket policy restrictions.";
  }

  return "Aliyun OSS returned an error response. See the details below for the raw error summary.";
}

function parseOssError(rawText: string): ParsedOssError {
  return {
    code: extractXmlTag(rawText, "Code"),
    message: extractXmlTag(rawText, "Message"),
    requestId: extractXmlTag(rawText, "RequestId"),
    hostId: extractXmlTag(rawText, "HostId"),
    bucket: extractXmlTag(rawText, "Bucket"),
    endpoint: extractXmlTag(rawText, "Endpoint"),
    ec: extractXmlTag(rawText, "EC"),
  };
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\s\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim();
}
