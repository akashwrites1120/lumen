import type { Redis } from "ioredis";
import { ProgressEvent, progressChannel } from "@lumen/schemas";

export function publishProgress(redis: Redis, event: ProgressEvent): void {
  void redis.publish(progressChannel(event.projectId), JSON.stringify(event));
}
