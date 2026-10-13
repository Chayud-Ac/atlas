import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Build from @atlas/shared's source: no separate build step, and Vite bundles it anyway.
      '@atlas/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    // The Entra redirect URI is registered for exactly this origin (spec §6.3).
    port: 5173,
    strictPort: true,
    // Same origin as in the container, where nginx proxies /api, so the API needs no CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      reporter: ['text', 'json-summary'],
      // Reported only, no threshold for web (spec §14.4).
    },
  },
});
