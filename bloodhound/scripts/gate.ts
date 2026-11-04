// Local gate (replaces CI). Runs every check in order and stops at the first failure.
// On green, copies the code to .snapshots/<phase>/ (replaces Git as the safety point).
// Usage: pnpm gate            (no snapshot)
//        pnpm gate -- --phase=P1
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
const phase = phaseArg?.split('=')[1];

const steps: Array<{ name: string; cmd: string }> = [
  { name: 'postgres (docker compose)', cmd: 'docker compose up -d --wait' },
  { name: 'migrate dev database', cmd: 'pnpm db:migrate' },
  { name: 'migrate test database', cmd: 'dotenv -e .env.test -- prisma migrate deploy' },
  { name: 'typecheck', cmd: 'pnpm typecheck' },
  { name: 'unit + integration tests', cmd: 'pnpm test' },
  { name: 'build web app', cmd: 'pnpm build:web' },
  { name: 'e2e demo steps 1-9', cmd: 'pnpm test:e2e' },
];

// On Windows, cmd.exe cannot start the pnpm shim: call pnpm's JS entry through node instead.
const pnpmEntry = process.env.npm_execpath ?? 'pnpm';
const pnpmCmd = pnpmEntry.endsWith('.cjs') || pnpmEntry.endsWith('.js') ? `"${process.execPath}" "${pnpmEntry}"` : `"${pnpmEntry}"`;
function resolveCmd(cmd: string): string {
  let out = cmd;
  if (out.startsWith('pnpm ')) out = `${pnpmCmd} ${out.slice(5)}`;
  if (out.startsWith('dotenv ')) out = `"${process.execPath}" "${join(ROOT, 'node_modules', 'dotenv-cli', 'cli.js')}" ${out.slice(7)}`;
  return out;
}

const results: Array<{ name: string; ok: boolean; ms: number }> = [];
let failed = false;
for (const step of steps) {
  const started = Date.now();
  process.stdout.write(`\n=== ${step.name}\n`);
  try {
    execSync(resolveCmd(step.cmd), { cwd: ROOT, stdio: 'inherit' });
    results.push({ name: step.name, ok: true, ms: Date.now() - started });
  } catch {
    results.push({ name: step.name, ok: false, ms: Date.now() - started });
    failed = true;
    break;
  }
}

console.log('\n=== gate summary');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${Math.round(r.ms / 1000)}s)`);

if (failed) {
  console.log('\ngate RED: no snapshot written');
  process.exit(1);
}

if (phase) {
  const dest = join(ROOT, '.snapshots', phase);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  // copy top-level entries one by one: the snapshot lives inside ROOT, so a whole-tree copy would recurse into itself
  const skip = new Set(['node_modules', '.work', '.snapshots', '.next', 'test-results', 'playwright-report']);
  for (const entry of readdirSync(ROOT)) {
    // never copy secrets: .env, .env.local, .env.test, ...
    if (skip.has(entry) || entry.startsWith('.env')) continue;
    cpSync(join(ROOT, entry), join(dest, entry), { recursive: true });
  }
  console.log(`\nsnapshot written: ${existsSync(dest) ? dest : '(failed)'}`);
}
console.log('\ngate GREEN');

