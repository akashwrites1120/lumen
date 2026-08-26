import type { ImageClass } from "@lumen/schemas";

export interface VisionInput {
  /** Raw image bytes. */
  bytes: Buffer;
  mimeType: string;
}

export interface DescribeContext {
  documentTitle?: string | null;
  sectionTitle?: string | null;
  surroundingText?: string | null;
  language?: string;
}

export interface DescribeRequest {
  image: VisionInput;
  context?: DescribeContext;
  styleGuide?: {
    maxAltChars?: number;
    includeLongDescription?: boolean;
  };
}

export interface AltTextDraft {
  imageClass: ImageClass;
  altText: string;
  longDescription: string | null;
  /** 0–100 self-reported model confidence. */
  confidence: number;
  provider: string;
  model: string;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  classify(image: VisionInput): Promise<ImageClass>;
  describe(req: DescribeRequest): Promise<AltTextDraft>;
}
