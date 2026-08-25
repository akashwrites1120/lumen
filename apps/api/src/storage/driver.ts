export interface PutResult {
  storageKey: string;
  byteSize: number;
  checksumSha256: string;
}

export interface StorageDriver {
  put(input: {
    scope: string;
    filename: string;
    contentType: string;
    body: Buffer;
  }): Promise<PutResult>;
  get(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}
