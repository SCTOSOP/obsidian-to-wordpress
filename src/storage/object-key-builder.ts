import type { ImageUploadInput } from "./image-storage-provider";

export async function buildObjectKey(rule: string, input: ImageUploadInput): Promise<string> {
  const now = new Date();
  const extension = getExtension(input.fileName);
  const fileBaseName = input.fileName.slice(0, input.fileName.length - extension.length - 1);
  const hash = await sha256Hex(input.body);
  const values: Record<string, string> = {
    postTitle: input.postTitle,
    fileName: input.fileName,
    fileBaseName,
    ext: extension,
    yyyy: String(now.getFullYear()),
    mm: String(now.getMonth() + 1).padStart(2, "0"),
    dd: String(now.getDate()).padStart(2, "0"),
    hash: hash.slice(0, 16),
  };

  const expanded = (rule || "obsidian/{yyyy}/{mm}/{postTitle}/{hash}-{fileName}")
    .replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => values[token] ?? "")
    .replace(/^\/+/, "");

  return expanded.split("/")
    .map((segment) => sanitizeSegment(segment))
    .filter(Boolean)
    .join("/");
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[\\:*?"<>|]/g, "-").replace(/\s+/g, "-");
}

function getExtension(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1] ?? "bin";
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
