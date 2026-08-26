import { z } from "zod";
import { ImageClass } from "@lumen/schemas";
import type {
  AltTextDraft,
  DescribeRequest,
  VisionInput,
  VisionProvider,
} from "./types.js";

const draftSchema = z.object({
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

function systemPrompt(req: DescribeRequest): string {
  const maxAlt = req.styleGuide?.maxAltChars ?? 125;
  const lang = req.context?.language ?? "en";
  return [
    "You are an accessibility expert producing WCAG-compliant image descriptions.",
    "Respond with STRICT JSON only, no markdown fences, matching:",
    '{"image_class":"photograph|chart|diagram|table_scan|infographic|decorative|unknown",',
    ' "alt_text":"...", "long_description":"..." | null, "confidence":0-100}',
    `Rules: alt_text <= ${maxAlt} chars, no "image of" phrasing, written in ${lang}.`,
    req.styleGuide?.includeLongDescription === false
      ? "Set long_description to null."
      : "Provide long_description (2-6 sentences) when the image is complex (chart/diagram/table/infographic), else null.",
    "Use class \"decorative\" only for pure ornament; then set alt_text to the empty string.",
  ].join("\n");
}

function userPrompt(req: DescribeRequest): string {
  const ctx = req.context;
  const lines: string[] = [];
  if (ctx?.documentTitle) lines.push(`Document title: ${ctx.documentTitle}`);
  if (ctx?.sectionTitle) lines.push(`Section heading: ${ctx.sectionTitle}`);
  if (ctx?.surroundingText)
    lines.push(`Surrounding text: ${ctx.surroundingText.slice(0, 600)}`);
  return [
    lines.length ? lines.join("\n") : "(no textual context available)",
    "",
    "Describe the attached image per the system rules.",
  ].join("\n");
}

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
          { role: "system", content: systemPrompt(req) },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt(req) },
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
