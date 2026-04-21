import { TFile } from "obsidian";
import type { Logger } from "./types";

export interface PreparedImageUpload {
  body: ArrayBuffer;
  mimeType: string;
  fileName: string;
  originalBytes: number;
  uploadBytes: number;
  compressed: boolean;
}

export interface ImageCompressor {
  prepare(file: TFile, body: ArrayBuffer, mimeType: string, quality: number): Promise<PreparedImageUpload>;
}

export class BrowserImageCompressor implements ImageCompressor {
  constructor(private logger: Logger) {}

  async prepare(file: TFile, body: ArrayBuffer, mimeType: string, quality: number): Promise<PreparedImageUpload> {
    if (!isCompressibleMimeType(mimeType)) {
      return this.original(file, body, mimeType, "Image type is not safely compressible");
    }

    try {
      const bitmap = await createImageBitmap(new Blob([body], { type: mimeType }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) return this.original(file, body, mimeType, "Canvas 2D context is unavailable");

      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      const targetMimeType = mimeType === "image/png" && hasAlpha(context, canvas.width, canvas.height)
        ? "image/png"
        : mimeType === "image/webp"
          ? "image/webp"
          : "image/jpeg";
      const blob = await canvasToBlob(canvas, targetMimeType, clampQuality(quality));
      if (!blob) return this.original(file, body, mimeType, "Canvas compression produced no output");

      const compressedBody = await blob.arrayBuffer();
      if (compressedBody.byteLength >= body.byteLength) {
        return this.original(file, body, mimeType, "Compressed image is not smaller than original");
      }

      const prepared = {
        body: compressedBody,
        mimeType: targetMimeType,
        fileName: replaceExtension(file.name, extensionForMimeType(targetMimeType)),
        originalBytes: body.byteLength,
        uploadBytes: compressedBody.byteLength,
        compressed: true,
      };
      this.logger.info("Compressed image", {
        path: file.path,
        originalBytes: prepared.originalBytes,
        uploadBytes: prepared.uploadBytes,
        mimeType: prepared.mimeType,
      });
      return prepared;
    } catch (error) {
      this.logger.warn("Image compression failed; uploading original image", serializeError(error));
      return this.original(file, body, mimeType, "Compression failed");
    }
  }

  private original(file: TFile, body: ArrayBuffer, mimeType: string, reason: string): PreparedImageUpload {
    this.logger.info("Using original image bytes", { path: file.path, reason, bytes: body.byteLength, mimeType });
    return {
      body,
      mimeType,
      fileName: file.name,
      originalBytes: body.byteLength,
      uploadBytes: body.byteLength,
      compressed: false,
    };
  }
}

function isCompressibleMimeType(mimeType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType);
}

function hasAlpha(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function clampQuality(value: number): number {
  if (Number.isNaN(value)) return 0.82;
  return Math.min(1, Math.max(0.1, value));
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return "jpg";
}

function replaceExtension(fileName: string, extension: string): string {
  return fileName.replace(/\.[^.]+$/, `.${extension}`);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}
