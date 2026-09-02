import { createHash } from "node:crypto";

/**
 * Senior spot-check sampling (Phase 3).
 *
 * `sampleForSpotCheck` deterministically picks `rate`-fraction of approved
 * assets using a hash of (projectId + assetId). Determinism matters: re-running
 * the sampler on the same project yields the same sample, so it is safe to
 * call from an "open export gate" path without creating duplicate or
 * arbitrary spot-check rows.
 */
export function sampleForSpotCheck(
  projectId: string,
  assetIds: string[],
  rate: number,
  seed = "lumen-spot-check-v1"
): string[] {
  if (assetIds.length === 0 || rate <= 0) return [];
  if (rate >= 1) return [...assetIds];
  const result: string[] = [];
  for (const assetId of assetIds) {
    const digest = createHash("sha256")
      .update(`${seed}\n${projectId}\n${assetId}`)
      .digest("hex");
    const bucket = parseInt(digest.slice(0, 8), 16) / 0xffffffff; // 0..1
    if (bucket < rate) result.push(assetId);
  }
  return result;
}

/** Reads SPOT_CHECK_RATE from env (default 0.1 = 10% of approved assets). */
export function spotCheckRateFromEnv(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.SPOT_CHECK_RATE;
  if (!raw) return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}