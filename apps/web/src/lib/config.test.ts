import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, loadRuntimeConfig, RuntimeConfig } from './config';
import { server } from '@/testing/mock-api';

const msalConfig = {
  env: 'dev',
  auth: {
    kind: 'msal',
    authority: 'https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000',
    clientId: 'web-client-id',
    apiScope: 'api://api-client-id/access_as_user',
  },
};

const mockConfig = {
  env: 'local',
  auth: {
    kind: 'mock',
    authority: 'http://localhost:8090/atlas',
    clientId: 'atlas-web',
    apiScope: 'atlas-api/access_as_user',
  },
};

describe('RuntimeConfig', () => {
  it('accepts MSAL sign-in for a cloud environment', () => {
    expect(RuntimeConfig.parse(msalConfig)).toEqual(msalConfig);
  });

  it('accepts mock sign-in locally', () => {
    expect(RuntimeConfig.parse(mockConfig)).toEqual(mockConfig);
  });

  it.each(['dev', 'uat', 'prod'])('refuses mock sign-in in %s', (env) => {
    expect(RuntimeConfig.safeParse({ ...mockConfig, env }).success).toBe(false);
  });

  it('refuses an http authority for MSAL', () => {
    const config = {
      ...msalConfig,
      auth: { ...msalConfig.auth, authority: 'http://login.example.com' },
    };
    expect(RuntimeConfig.safeParse(config).success).toBe(false);
  });

  it('refuses a missing client id', () => {
    const config = { ...msalConfig, auth: { ...msalConfig.auth, clientId: '' } };
    expect(RuntimeConfig.safeParse(config).success).toBe(false);
  });

  it('accepts an Application Insights connection string', () => {
    const config = {
      ...msalConfig,
      telemetry: { connectionString: 'InstrumentationKey=k;IngestionEndpoint=https://in.example/' },
    };
    expect(RuntimeConfig.parse(config)).toEqual(config);
  });

  it('accepts an empty connection string: telemetry is off', () => {
    const config = { ...mockConfig, telemetry: { connectionString: '' } };
    expect(RuntimeConfig.parse(config)).toEqual(config);
  });
});

describe('loadRuntimeConfig', () => {
  it('fetches /config.json, bypassing the browser cache', async () => {
    server.use(http.get('/config.json', () => HttpResponse.json(mockConfig)));
    // Spy on fetch itself: MSW 3 hands handlers a rebuilt Request whose `cache` reads 'default'.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(loadRuntimeConfig()).resolves.toEqual(mockConfig);

    expect(fetchSpy).toHaveBeenCalledWith(new URL('/config.json', window.location.origin), {
      cache: 'no-store',
    });
  });

  it('fails clearly when /config.json is missing', async () => {
    server.use(http.get('/config.json', () => new HttpResponse(null, { status: 404 })));
    await expect(loadRuntimeConfig()).rejects.toThrow(ConfigError);
  });

  it('fails clearly when /config.json is invalid', async () => {
    server.use(http.get('/config.json', () => HttpResponse.json({ env: 'local' })));
    await expect(loadRuntimeConfig()).rejects.toThrow(/Invalid \/config.json/);
  });

  it('fails clearly when /config.json is not JSON', async () => {
    server.use(http.get('/config.json', () => HttpResponse.text('<html></html>')));
    await expect(loadRuntimeConfig()).rejects.toThrow(ConfigError);
  });
});
