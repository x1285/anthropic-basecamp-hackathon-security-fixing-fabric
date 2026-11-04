// Finds the repo root (the folder with pnpm-workspace.yaml) whatever the caller's cwd is, and loads .env.local.
// Values already set in the environment win, so `dotenv -e .env.test` keeps the test database.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
  return dir;
}

export const ROOT = findRoot(process.cwd());

const local = join(ROOT, '.env.local');
if (existsSync(local)) process.loadEnvFile(local);
