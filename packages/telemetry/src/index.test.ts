import { describe, expect, it } from "vitest";
import { startTelemetry, telemetryEnabled } from "./index.js";

describe("telemetryEnabled", () => {
  it("is off unless an OTLP endpoint is configured", () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" })).toBe(true);
  });
});

describe("startTelemetry", () => {
  it("resolves disabled with no shutdown cost when unconfigured", async () => {
    const handle = await startTelemetry("lumen-test", {});
    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
