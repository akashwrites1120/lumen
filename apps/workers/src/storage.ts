import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredAsset {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
}

export interface AssetStore {
  read(storageKey: string): Promise<Buffer>;
  write(scope: string, filename: string, body: Buffer): Promise<StoredAsset>;
  writeRaw(storageKey: string, body: Buffer): Promise<void>;
}

class LocalAssetStore implements AssetStore {
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
    await this.writeRaw(storageKey, body);
    return { storageKey, byteSize: body.byteLength, checksumSha256 };
  }

  async writeRaw(storageKey: string, body: Buffer): Promise<void> {
    if (storageKey.includes("..")) throw new Error(`invalid asset key: ${storageKey}`);
    const target = this.abs(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
}

class S3AssetStore implements AssetStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    endpoint?: string
  ) {
    this.client = new S3Client({
      region: process.env.AWS_REGION ?? "us-east-1",
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true" || Boolean(endpoint),
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async read(storageKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`s3 object empty: ${storageKey}`);
    return Buffer.from(bytes);
  }

  async write(scope: string, filename: string, body: Buffer): Promise<StoredAsset> {
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    const storageKey = `${scope}/${checksumSha256.slice(0, 16)}${ext}`;
    await this.putObject(storageKey, body);
    return { storageKey, byteSize: body.byteLength, checksumSha256 };
  }

  async writeRaw(storageKey: string, body: Buffer): Promise<void> {
    await this.putObject(storageKey, body);
  }

  private putObject(key: string, body: Buffer): Promise<unknown> {
    return this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }));
  }

  remove(storageKey: string): Promise<unknown> {
    return this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
  }
}

export function createAssetStoreFromEnv(): AssetStore {
  if (process.env.STORAGE_DRIVER === "s3" && process.env.S3_BUCKET) {
    console.log(`[workers] asset store: s3 (${process.env.S3_BUCKET})`);
    return new S3AssetStore(process.env.S3_BUCKET, process.env.S3_ENDPOINT);
  }
  console.log("[workers] asset store: local-disk");
  return new LocalAssetStore(process.env.STORAGE_LOCAL_ROOT ?? ".data/storage");
}
