import { z } from "zod";
import { ImageClass } from "@lumen/schemas";
import type {
  AltTextDraft,
  DescribeRequest,
  VisionInput,
  VisionProvider,
} from "./types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";

export const draftSchema = z.object({
  image_class: ImageClass,
  alt_text: z.string().min(1),
  long_description: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100),
});

export interface OpenAiAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAiVisionProvider implements VisionProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAiAdapterConfig) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.model ?? DEFAULT_MODEL;
    this.name = this.baseUrl.includes("openai.com") ? "openai" : new URL(this.baseUrl).host;
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

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt(req) },
          {
            role: "user",
            content: [
              { type: "text", text: buildUserPrompt(req) },
              {
                type: "image_url",
                image_url: {
                  url: `data:${req.image.mimeType};base64,${req.image.bytes.toString("base64")}`,
                  detail: "low",
                },
              },
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

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name}: empty completion`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
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
