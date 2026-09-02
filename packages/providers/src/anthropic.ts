import { z } from "zod";
import { ImageClass } from "@lumen/schemas";
import type {
  AltTextDraft,
  DescribeRequest,
  VisionInput,
  VisionProvider,
} from "./types.js";
import { draftSchema } from "./openai.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";

export interface AnthropicAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

export class AnthropicVisionProvider implements VisionProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: AnthropicAdapterConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.model = config.model ?? DEFAULT_MODEL;
    this.name = this.baseUrl.includes("anthropic.com") ? "anthropic" : new URL(this.baseUrl).host;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async classify(image: VisionInput): Promise<ImageClass> {
    const draft = await this.describe({ image });
    return draft.imageClass;
  }

  async describe(req: DescribeRequest): Promise<AltTextDraft> {
    if (!this.isConfigured()) throw new Error(`${this.name}: missing api key`);

    // anthropic rejects svg; degrade to png raster assumption is unsafe — fail fast
    if (req.image.mimeType === "image/svg+xml") {
      throw new Error(`${this.name}: svg input unsupported`);
    }
    const mediaType = req.image.mimeType.startsWith("image/") ? req.image.mimeType : null;
    if (!mediaType) throw new Error(`${this.name}: unsupported media ${req.image.mimeType}`);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        temperature: 0.2,
        system: buildSystemPrompt(req),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: req.image.bytes.toString("base64"),
                },
              },
              { type: "text", text: buildUserPrompt(req) },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${this.name} http ${res.status}: ${body.slice(0, 300)}`);
    }

    const payload = responseSchema.parse(await res.json());
    const text =
      payload.content.find((c) => c.type === "text" && c.text)?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim().replace(/^```json\s*|```$/g, ""));
    } catch {
      throw new Error(`${this.name}: non-JSON completion`);
    }
    const draft = draftSchema.parse(parsed);

    return {
      imageClass: draft.image_class,
      altText: draft.alt_text.trim(),
      longDescription:
        req.styleGuide?.includeLongDescription === false
          ? null
          : (draft.long_description ?? null),
      confidence: Math.round(draft.confidence),
      provider: this.name,
      model: this.model,
    };
  }
}
