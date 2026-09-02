import { usageEvents, type LumenDb } from "@lumen/db";
import type { usageKind } from "@lumen/db";

export type UsageKind = (typeof usageKind.enumValues)[number];

export interface RecordUsageInput {
  organizationId: string;
  kind: UsageKind;
  units?: number;
  subjectType?: string;
  subjectId?: string;
  detail?: unknown;
}

/**
 * Append a single row to the usage_events ledger. Failures are logged and
 * swallowed so a metering problem never breaks the calling job — usage is
 * observability, not a hard dependency.
 */
export async function recordUsage(db: LumenDb, input: RecordUsageInput): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      organizationId: input.organizationId,
      kind: input.kind,
      units: input.units ?? 1,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      detail: input.detail === undefined ? null : (input.detail as Record<string, unknown>),
    });
  } catch (err) {
    // intentionally swallow — usage is best-effort
    console.warn(
      `[usage] failed to record ${input.kind} for org=${input.organizationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
