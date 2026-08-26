import type { DescribeRequest, VisionProvider, AltTextDraft } from "./types.js";

export class AllProvidersFailedError extends Error {
  constructor(
    public readonly failures: { provider: string; error: unknown }[]
  ) {
    super(
      `all vision providers failed: ${failures
        .map((f) => `${f.provider}: ${summarize(f.error)}`)
        .join(" | ")}`
    );
    this.name = "AllProvidersFailedError";
  }
}

function summarize(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FailoverOptions {
  /** Attempts per provider before moving to the next one. */
  attemptsPerProvider?: number;
  baseDelayMs?: number;
}

/**
 * Runs `op` against each provider in order, retrying with exponential backoff.
 * Returns the first success together with the provider that produced it.
 */
export async function runWithFailover<T>(
  providers: VisionProvider[],
  op: (provider: VisionProvider) => Promise<T>,
  opts: FailoverOptions = {}
): Promise<{ result: T; provider: VisionProvider }> {
  const attemptsPerProvider = opts.attemptsPerProvider ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  const failures: { provider: string; error: unknown }[] = [];
  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    for (let attempt = 1; attempt <= attemptsPerProvider; attempt++) {
      try {
        return { result: await op(provider), provider };
      } catch (err) {
        failures.push({ provider: provider.name, error: err });
        if (attempt < attemptsPerProvider) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
        }
      }
    }
  }
  throw new AllProvidersFailedError(failures);
}

/** Convenience wrapper typed for describe(). */
export function describeWithFailover(
  providers: VisionProvider[],
  req: DescribeRequest,
  opts?: FailoverOptions
): Promise<{ result: AltTextDraft; provider: VisionProvider }> {
  return runWithFailover(providers, (p) => p.describe(req), opts);
}
