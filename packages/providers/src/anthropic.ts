import { z } from "zod";
import { ImageClass } from "@lumen/schemas";
import type {
  AltTextDraft,
  DescribeRequest,
  VisionInput,
  VisionProvider,
} from "./types.js";
import { draftSchema } from "./openai.js";

export interface AnthropicAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

const responseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});

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
    'Use class "decorative" only for pure ornament; then set alt_text to the empty string.',
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
        system: systemPrompt(req),
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
              { type: "text", text: userPrompt(req) },
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
