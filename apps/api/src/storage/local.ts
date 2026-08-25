import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { StorageDriver } from "./driver.js";

export class LocalDiskStorage implements StorageDriver {
  constructor(private readonly root: string) {}

  private abs(key: string): string {
    return resolve(this.root, key);
  }

  async put(input: {
    scope: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }) {
    void input.contentType;
    const safeName = input.filename.replace(/[^\w.\-]+/g, "_");
    const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const storageKey = `${input.scope}/${unique}-${safeName}`;
    const target = this.abs(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return {
      storageKey,
      byteSize: input.body.byteLength,
      checksumSha256: (await import("node:crypto")).createHash("sha256").update(input.body).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const resolved = this.abs(storageKey);
    if (!resolved.startsWith(resolve(this.root))) {
      throw new Error("invalid storage key");
    }
    return readFile(resolved);
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.abs(storageKey), { force: true });
  }
}

export function joinStoragePath(root: string, key: string): string {
  return join(root, key);
}
