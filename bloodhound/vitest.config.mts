import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.work/**', '**/.snapshots/**'],
    testTimeout: 30000,
    // DB tests share one database and reseed it: run files one after another.
    fileParallelism: false,
  },
});
