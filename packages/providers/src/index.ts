import { MockVisionProvider } from "./mock.js";
import { OpenAiVisionProvider } from "./openai.js";
import type { VisionProvider } from "./types.js";

export type { AltTextDraft, DescribeRequest, VisionInput, VisionProvider } from "./types.js";
export { AllProvidersFailedError, describeWithFailover, runWithFailover } from "./failover.js";
export type { FailoverOptions } from "./failover.js";
export { MockVisionProvider } from "./mock.js";
export { OpenAiVisionProvider } from "./openai.js";
export type { OpenAiAdapterConfig } from "./openai.js";

export interface ProviderEnv {
  AI_PROVIDER_ORDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_VISION_MODEL?: string;
}

/**
 * Builds the provider failover chain from env.
 * AI_PROVIDER_ORDER="openai,mock" → try OpenAI first, fall back to deterministic mock.
 * Unset/empty order falls back to: openai (if key present) then mock.
 */
export function resolveVisionProviders(env: ProviderEnv): VisionProvider[] {
  const candidates = new Map<string, () => VisionProvider>([
    [
      "mock",
      () => new MockVisionProvider(),
    ],
    [
      "openai",
      () =>
        new OpenAiVisionProvider({
          apiKey: env.OPENAI_API_KEY ?? "",
          baseUrl: env.OPENAI_BASE_URL,
          model: env.OPENAI_VISION_MODEL,
        }),
    ],
  ]);

  const order = (env.AI_PROVIDER_ORDER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const names = order.length > 0 ? order : env.OPENAI_API_KEY ? ["openai", "mock"] : ["mock"];

  const providers: VisionProvider[] = [];
  for (const name of names) {
    const factory = candidates.get(name);
    if (!factory) continue;
    const p = factory();
    if (!providers.some((existing) => existing.name === p.name)) providers.push(p);
  }
  if (providers.length === 0) providers.push(new MockVisionProvider());
  return providers;
}
