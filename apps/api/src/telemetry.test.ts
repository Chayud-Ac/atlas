import { describe, expect, it } from 'vitest';
import { startTelemetry } from './telemetry.js';

describe('startTelemetry', () => {
  it('stays off without a connection string (locally and in CI)', () => {
    expect(startTelemetry({})).toBe(false);
    expect(startTelemetry({ APPLICATIONINSIGHTS_CONNECTION_STRING: '' })).toBe(false);
  });
});
