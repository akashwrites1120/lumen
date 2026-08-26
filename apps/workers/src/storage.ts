import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export interface StoredAsset {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
}

export class AssetStore {
  constructor(private readonly root: string) {}

  private abs(key: string): string {
    const resolved = resolve(this.root, key);
    if (!resolved.startsWith(resolve(this.root))) {
      throw new Error(`invalid asset key: ${key}`);
    }
    return resolved;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.abs(storageKey));
  }

  async write(scope: string, filename: string, body: Buffer): Promise<StoredAsset> {
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    const storageKey = `${scope}/${checksumSha256.slice(0, 16)}${ext}`;
    const target = this.abs(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { storageKey, byteSize: body.byteLength, checksumSha256 };
  }

  /** Writes at an exact storage key — used for export artifacts. */
  async writeRaw(storageKey: string, body: Buffer): Promise<void> {
    if (storageKey.includes("..")) throw new Error(`invalid asset key: ${storageKey}`);
    const target = this.abs(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  pathOf(storageKey: string): string {
    return join(this.root, storageKey);
  }
}
