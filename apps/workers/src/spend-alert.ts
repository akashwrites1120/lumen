import { and, eq, gte, sql } from "drizzle-orm";
import { notifications, usageEvents, type LumenDb } from "@lumen/db";

/**
 * Monthly vision-call alert threshold per org, in ledger units.
 * 0 (or invalid) disables spend alerts entirely.
 */
export function spendAlertThresholdFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ORG_MONTHLY_VISION_ALERT ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/** Calendar-month boundary used for the alert window (server-local time). */
export function monthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export interface SpendAlertDeps {
  threshold: number;
  now?: Date;
}

/**
 * Fires at most one org-wide `usage.alert` notification per calendar month
 * when the org's vision-call volume (from the usage_events ledger) crosses
 * the configured threshold. Never throws — alerting must not break a
 * draft job. Cached calls record zero units, so they neither trigger nor
 * delay the threshold.
 */
export async function maybeAlertMonthlySpend(
  db: LumenDb,
  organizationId: string,
  deps: SpendAlertDeps
): Promise<boolean> {
  if (deps.threshold <= 0) return false;
  try {
    const since = monthStart(deps.now ?? new Date());
    const usageRows = await db
      .select({ units: sql<number>`coalesce(sum(${usageEvents.units}), 0)::int` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          eq(usageEvents.kind, "vision_call"),
          gte(usageEvents.at, since)
        )
      );
    const monthlyUnits = usageRows[0]?.units ?? 0;
    if (monthlyUnits < deps.threshold) return false;

    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.kind, "usage.alert"),
          gte(notifications.createdAt, since)
        )
      )
      .limit(1);
    if (existing.length > 0) return false;

    await db.insert(notifications).values({
      organizationId,
      userId: null, // org-wide
      kind: "usage.alert",
      title: `Usage alert: ${monthlyUnits} vision calls this month`,
      body: `This org crossed the ${deps.threshold} vision-call monthly alert threshold. Review pipeline volume or adjust ORG_MONTHLY_VISION_ALERT.`,
      subjectType: "organization",
      subjectId: organizationId,
    });
    return true;
  } catch (err) {
    console.warn("[spend-alert] failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
