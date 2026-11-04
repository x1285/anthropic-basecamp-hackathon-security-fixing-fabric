// Locates the bloodhound/ root and loads its env files. The API key is read, never printed.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export const ROOT = findRoot();
export const MOCKDATA = join(ROOT, 'mockdata');

function loadEnv(file: string): void {
  const path = join(ROOT, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
// .env holds ANTHROPIC_API_KEY (user-provided); .env.local holds DATABASE_URL (written by the orchestrator).
for (const f of ['.env.local', '.env']) {
  try {
    loadEnv(f);
  } catch {
    // unreadable env file: the caller will see missing variables later
  }
}

export function workDir(runId: string, repoId: string): string {
  return join(ROOT, '.work', runId, repoId);
}
