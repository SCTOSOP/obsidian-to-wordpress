import { requestUrl } from "obsidian";
import type { Logger } from "./types";

export type MediaUrlStatus = "available" | "missing" | "unknown";

export interface MediaUrlChecker {
  check(url: string, referer?: string): Promise<MediaUrlStatus>;
}

export class HttpMediaUrlChecker implements MediaUrlChecker {
  constructor(private logger: Logger) {}

  async check(url: string, referer?: string): Promise<MediaUrlStatus> {
    this.logger.info("Checking cached media URL", { url, referer });
    const headers = referer ? { Referer: referer } : undefined;

    try {
      const head = await requestUrl({ url, method: "HEAD", headers, throw: false });
      const headStatus = classifyStatus(head.status);
      if (headStatus !== "unknown") {
        this.logger.info("Cached media HEAD check completed", { url, status: head.status, result: headStatus });
        return headStatus;
      }

      const get = await requestUrl({
        url,
        method: "GET",
        headers: { ...(headers ?? {}), Range: "bytes=0-0" },
        throw: false,
      });
      const getStatus = classifyStatus(get.status);
      this.logger.info("Cached media GET check completed", { url, status: get.status, result: getStatus });
      return getStatus;
    } catch (error) {
      this.logger.warn("Cached media URL check failed due to network or client error", serializeError(error));
      return "unknown";
    }
  }
}

function classifyStatus(status: number): MediaUrlStatus {
  if ((status >= 200 && status < 400) || status === 206) return "available";
  if (status === 404 || status === 410) return "missing";
  return "unknown";
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
