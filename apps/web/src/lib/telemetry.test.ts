import type { ITelemetryItem } from '@microsoft/applicationinsights-web';
import { describe, expect, it } from 'vitest';
import { setRoleName, startTelemetry } from './telemetry';

// Sending for real is the E2E test's job (telemetry.spec.ts): jsdom doesn't enforce the CSP.
describe('startTelemetry', () => {
  it('does nothing without a connection string', () => {
    expect(startTelemetry(undefined)).toBeUndefined();
    expect(startTelemetry('')).toBeUndefined();
  });
});

describe('setRoleName', () => {
  it('names the browser in the application map, keeping other tags', () => {
    const item: ITelemetryItem = { name: 'pageview', tags: { 'ai.session.id': 's1' } };
    setRoleName(item);
    expect(item.tags).toEqual({ 'ai.session.id': 's1', 'ai.cloud.role': 'atlas-web' });
  });
});
