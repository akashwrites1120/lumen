import { createHash, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { PutResult, StorageDriver } from "./driver.js";

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export function s3ClientFromEnv(env: NodeJS.ProcessEnv = process.env): S3Client {
  return new S3Client({
    region: env.AWS_REGION ?? "us-east-1",
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true" || Boolean(env.S3_ENDPOINT),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

/** StorageDriver over any S3-compatible API (AWS S3, MinIO, R2). */
export class S3Storage implements StorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    clientOrConfig: S3Client | S3StorageConfig
  ) {
    this.client =
      clientOrConfig instanceof S3Client
        ? clientOrConfig
        : (() => {
            const cfg = clientOrConfig;
            return new S3Client({
              region: cfg.region ?? "us-east-1",
              ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
              forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
              ...(cfg.accessKeyId && cfg.secretAccessKey
                ? {
                    credentials: {
                      accessKeyId: cfg.accessKeyId,
                      secretAccessKey: cfg.secretAccessKey,
                    },
                  }
                : {}),
            });
          })();
  }

  async put(input: {
    scope: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<PutResult> {
    const safeName = input.filename.replace(/[^\w.\-]+/g, "_");
    const storageKey = `${input.scope}/${Date.now().toString(36)}-${randomBytes(4).toString("hex")}-${safeName}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: input.body,
        ContentType: input.contentType,
      })
    );
    return {
      storageKey,
      byteSize: input.body.byteLength,
      checksumSha256: createHash("sha256").update(input.body).digest("hex"),
    };
  }

  async get(storageKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`s3 object empty: ${storageKey}`);
    return Buffer.from(bytes);
  }

  async remove(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
  }
}
