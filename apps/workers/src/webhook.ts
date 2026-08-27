import { createHmac, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Job, Queue } from "bullmq";
import { webhookEndpoints, type LumenDb } from "@lumen/db";

export const WEBHOOK_QUEUE = "webhook.q";

export interface WebhookJobData {
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  attemptStartedAt?: string;
}

export interface WebhookDeps {
  db: LumenDb;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/**
 * Fans an org-scoped event out to every active subscribed endpoint.
 * Safe to call when the queue is absent (dev without delivery worker).
 */
export async function dispatchWebhookEvent(
  db: LumenDb,
  webhookQueue: Queue | undefined,
  organizationId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<number> {
  if (!webhookQueue) return 0;
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.active, true)
      )
    );
  let queued = 0;
  for (const ep of endpoints) {
    if (!ep.events.includes("*") && !ep.events.includes(event)) continue;
    await webhookQueue.add("webhook-delivery", {
      endpointId: ep.id,
      event,
      payload,
    } satisfies WebhookJobData);
    queued += 1;
  }
  return queued;
}

/** Delivery processor — HMAC-signed POST with BullMQ-managed retries. */
export async function processWebhookDelivery(
  job: Job<WebhookJobData>,
  deps: WebhookDeps
): Promise<{ delivered: boolean; status: number }> {
  const rows = await deps.db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.id, job.data.endpointId))
    .limit(1);
  const endpoint = rows[0];
  if (!endpoint || !endpoint.active) {
    return { delivered: false, status: 0 };
  }

  const body = JSON.stringify({
    id: randomBytes(12).toString("hex"),
    event: job.data.event,
    created_at: new Date().toISOString(),
    data: job.data.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lumen-event": job.data.event,
      "x-lumen-signature": signPayload(endpoint.secret, timestamp, body),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status >= 200 && res.status < 300) {
    return { delivered: true, status: res.status };
  }
  throw new Error(`webhook ${endpoint.url} responded ${res.status}`);
}
