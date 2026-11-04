// Resets the test database to the mock world before the E2E run.
// The seed runs in its own process: Playwright loads this file as CommonJS, the engine is ESM.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes('bloodhound_test')) throw new Error('E2E must run against bloodhound_test');
  const root = resolve(__dirname, '../../../..');
  execFileSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, 'scripts/seed.ts')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}
