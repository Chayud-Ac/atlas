import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against @atlas/shared's source, so `npm test` works without building it first.
      '@atlas/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        // Wiring and Postgres code: exercised by the integration tests instead.
        'src/server.ts',
        'src/migrate.ts',
        'src/db/schema.ts',
        'src/db/client.ts',
        'src/db/entra-token.ts',
        'src/db/migration-job.ts',
        'src/**/pg-*.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80 },
    },
  },
});
