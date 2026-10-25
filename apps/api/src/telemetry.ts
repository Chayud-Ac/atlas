import type { IncomingMessage } from 'node:http';
import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { metrics, trace } from '@opentelemetry/api';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';

/**
 * Sends the API's requests, SQL queries, metrics and exceptions to Application Insights (spec
 * §11.1). Off without a connection string, so local runs and CI send nothing. The Dockerfile
 * loads this file with `node --import`, before server.js imports http, express and pg:
 * OpenTelemetry can only patch an ES module that hasn't been loaded yet.
 */
export function startTelemetry(env: Record<string, string | undefined>): boolean {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return false;

  // Container Apps probes the health endpoints every 10 seconds per replica: leave them out, so
  // they don't bury real requests (and Log Analytics bills per GB). Azure Monitor types this as
  // InstrumentationConfig, but hands it to OpenTelemetry's HttpInstrumentation, which reads the hook.
  const http = {
    enabled: true,
    ignoreIncomingRequestHook: (req: IncomingMessage) =>
      req.url?.startsWith('/api/health/') ?? false,
  };
  // The cloud role name, atlas-api, comes from OTEL_SERVICE_NAME (apps.bicep).
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    instrumentationOptions: { http },
  });
  // Express isn't one of Azure Monitor's built-in instrumentations. It names each request by its
  // route (`DELETE /api/notes/:id`) instead of its URL.
  registerInstrumentations({
    tracerProvider: trace.getTracerProvider(),
    meterProvider: metrics.getMeterProvider(),
    instrumentations: [new ExpressInstrumentation()],
  });
  return true;
}

startTelemetry(process.env);
