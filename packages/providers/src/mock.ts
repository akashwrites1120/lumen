import type { ImageClass } from "@lumen/schemas";
import type { AltTextDraft, DescribeRequest, VisionProvider, VisionInput } from "./types.js";

const CLASSES: ImageClass[] = [
  "photograph",
  "chart",
  "diagram",
  "infographic",
  "table_scan",
];

function hash(bytes: Buffer): number {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(bytes.byteLength / 4096));
  for (let i = 0; i < bytes.byteLength; i += step) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic offline provider. Produces plausible, stable drafts so the
 * whole pipeline (queue → draft → review → export) runs without API keys.
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  readonly model = "mock-vision-1";

  isConfigured(): boolean {
    return true;
  }

  async classify(image: VisionInput): Promise<ImageClass> {
    return CLASSES[hash(image.bytes) % CLASSES.length]!;
  }

  async describe(req: DescribeRequest): Promise<AltTextDraft> {
    const h = hash(req.image.bytes);
    const imageClass = await this.classify(req.image);
    const subject =
      req.context?.sectionTitle?.trim() ||
      req.context?.documentTitle?.trim() ||
      "the surrounding content";
    const altText =
      imageClass === "chart"
        ? `Chart illustrating ${subject}`
        : imageClass === "diagram"
          ? `Diagram explaining ${subject}`
          : imageClass === "infographic"
            ? `Infographic summarizing ${subject}`
            : imageClass === "table_scan"
              ? `Table of data related to ${subject}`
              : `Photograph depicting ${subject}`;
    return {
      imageClass,
      altText: altText.slice(0, req.styleGuide?.maxAltChars ?? 125),
      longDescription:
        req.styleGuide?.includeLongDescription === false
          ? null
          : `Auto-generated mock description for a ${imageClass} in "${subject}". Replace with a real vision model for production drafts.`,
      confidence: 55 + (h % 41),
      provider: this.name,
      model: this.model,
    };
  }
}
