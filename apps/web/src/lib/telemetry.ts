import {
  ApplicationInsights,
  DistributedTracingModes,
  type ITelemetryItem,
} from '@microsoft/applicationinsights-web';

/** How Application Insights' application map tells the browser from the API (atlas-api). */
export function setRoleName(item: ITelemetryItem): void {
  item.tags = { ...item.tags, 'ai.cloud.role': 'atlas-web' };
}

/**
 * Starts the Application Insights browser SDK when this environment has a connection string
 * (spec §10). It records page views, errors and fetches, and adds W3C `traceparent` to
 * same-origin requests, so a page view, its API calls and their SQL share one trace.
 */
export function startTelemetry(
  connectionString: string | undefined,
): ApplicationInsights | undefined {
  if (!connectionString) return undefined;
  const appInsights = new ApplicationInsights({
    config: {
      connectionString,
      // traceparent only: the default also sends the SDK's older Request-Id header.
      distributedTracingMode: DistributedTracingModes.W3C,
      // No ai_user or ai_session cookies.
      disableCookiesUsage: true,
      // By default the SDK fetches settings from js.monitor.azure.com, which the CSP blocks.
      extensionConfig: { AppInsightsCfgSyncPlugin: { blkCdnCfg: true } },
    },
  });
  appInsights.loadAppInsights();
  appInsights.addTelemetryInitializer(setRoleName);
  appInsights.trackPageView();
  return appInsights;
}
