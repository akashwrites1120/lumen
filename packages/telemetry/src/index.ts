export interface TelemetryHandle {
  serviceName: string;
  enabled: boolean;
  /** Present only when the SDK started; safe to call unconditionally. */
  shutdown: () => Promise<void>;
}

/** True when an OTLP endpoint is configured — tracing is strictly opt-in. */
export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

/**
 * Opt-in OpenTelemetry tracing for api + workers.
 *
 * Without OTEL_EXPORTER_OTLP_ENDPOINT this resolves immediately with
 * `enabled: false` and loads zero OTel modules — dev runs pay no startup
 * cost and carry no dependency weight at runtime. With it set, traces
 * (http, fastify, ioredis, queues) are batched to `<endpoint>/v1/traces`.
 */
export async function startTelemetry(
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<TelemetryHandle> {
  const disabled: TelemetryHandle = {
    serviceName,
    enabled: false,
    shutdown: async () => {},
  };
  if (!telemetryEnabled(env)) return disabled;

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");

    const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").replace(/\/$/, "");
    const sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    return {
      serviceName,
      enabled: true,
      shutdown: async () => {
        await sdk.shutdown();
      },
    };
  } catch (err) {
    console.warn(
      `[telemetry] failed to start for ${serviceName}:`,
      err instanceof Error ? err.message : err
    );
    return disabled;
  }
}
