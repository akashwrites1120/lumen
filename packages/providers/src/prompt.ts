import { languageName } from "@lumen/schemas";
import type { DescribeRequest } from "./types.js";

/**
 * Shared prompt builders for the hosted adapters. Kept in one place so
 * OpenAI and Anthropic produce equivalent requests (and so tests can
 * assert on the actual instructions sent to the model).
 */
export function buildSystemPrompt(req: DescribeRequest): string {
  const maxAlt = req.styleGuide?.maxAltChars ?? 125;
  const lang = req.context?.language ?? "en";
  return [
    "You are an accessibility expert producing WCAG-compliant image descriptions.",
    "Respond with STRICT JSON only, no markdown fences, matching:",
    '{"image_class":"photograph|chart|diagram|table_scan|infographic|decorative|unknown",',
    ' "alt_text":"...", "long_description":"..." | null, "confidence":0-100}',
    `Rules: alt_text <= ${maxAlt} chars, no "image of" phrasing.`,
    `Language: write all human-readable output (alt_text, long_description) in ${languageName(lang)} (${lang}).`,
    req.styleGuide?.includeLongDescription === false
      ? "Set long_description to null."
      : "Provide long_description (2-6 sentences) when the image is complex (chart/diagram/table/infographic), else null.",
    'Use class "decorative" only for pure ornament; then set alt_text to the empty string.',
  ].join("\n");
}

export function buildUserPrompt(req: DescribeRequest): string {
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
