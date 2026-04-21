import type { Logger, SecretStoreStatus } from "./types";

export interface SecretStore {
  status(): SecretStoreStatus;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ElectronSafeStorageSecretStore implements SecretStore {
  private safeStorage?: ElectronSafeStorage;
  private backend = "unavailable";
  private available = false;
  private secure = false;

  constructor(private data: Record<string, string>, private logger: Logger) {
    this.safeStorage = loadSafeStorage(logger);
    this.available = Boolean(this.safeStorage?.isEncryptionAvailable());
    this.backend = this.safeStorage?.getSelectedStorageBackend?.() ?? (this.available ? "os_crypt" : "unavailable");
    this.secure = this.available && this.backend !== "basic_text";
  }

  status(): SecretStoreStatus {
    return {
      available: this.available,
      secure: this.secure,
      backend: this.backend,
      warning: this.warning(),
    };
  }

  async get(key: string): Promise<string | undefined> {
    const encrypted = this.data[key];
    if (!encrypted || !this.safeStorage || !this.available) return undefined;

    try {
      return this.safeStorage.decryptString(base64ToBuffer(encrypted));
    } catch (error) {
      this.logger.warn("Failed to decrypt secret", { key, error: serializeError(error) });
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.safeStorage || !this.available) {
      throw new Error("Secure secret storage is unavailable on this system.");
    }

    const encrypted = this.safeStorage.encryptString(value);
    this.data[key] = bufferToBase64(encrypted);
  }

  async delete(key: string): Promise<void> {
    delete this.data[key];
  }

  private warning(): string | undefined {
    if (!this.available) return "Electron safeStorage encryption is unavailable. Sensitive settings cannot be saved securely.";
    if (this.backend === "basic_text") return "Electron safeStorage is using Linux basic_text backend. This is weak protection and should not be used for long-lived secrets.";
    return undefined;
  }
}

interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Uint8Array): string;
  getSelectedStorageBackend?(): string;
}

declare const require: ((module: string) => unknown) | undefined;

function loadSafeStorage(logger: Logger): ElectronSafeStorage | undefined {
  try {
    if (typeof require !== "function") return undefined;
    const electron = require("electron") as { remote?: { safeStorage?: ElectronSafeStorage }; safeStorage?: ElectronSafeStorage };
    return electron.safeStorage ?? electron.remote?.safeStorage;
  } catch (error) {
    logger.warn("Could not load Electron safeStorage", serializeError(error));
    return undefined;
  }
}

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}
