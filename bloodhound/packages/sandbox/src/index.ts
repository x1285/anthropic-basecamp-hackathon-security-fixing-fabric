// Sandbox: copies a mock repo into .work/, applies a recipe, simulates build/test, computes a diff.
// Mock repos in mockdata/ are never written to. Nothing from the repo is executed.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { satisfies as satisfiesRange } from '@bloodhound/core';

export type RecipeAction = 'bump-direct' | 'override' | 'add-verify-options';

export interface RecipeStep {
  action: RecipeAction;
  name?: string;
  to?: string;
}

export interface PackageLock {
  packages: Record<string, { version: string }>;
}

export interface TestRules {
  greenWhen: Record<string, string>;
  codeChecks: Array<{ file: string; pattern: string; mustAlso: string }>;
}

export interface TestResult {
  green: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

/** Copies a mock repo into a fresh work directory (the caller picks .work/<run>/<repo>). */
export async function prepareWorkdir(sourceDir: string, destDir: string): Promise<string> {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });
  return destDir;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/**
 * Applies recipe steps. Code changes are only applied when `allowCodeChanges` is true.
 * Returns which steps were applied and which were skipped, so the report can say why.
 */
export async function applyRecipe(
  workDir: string,
  steps: RecipeStep[],
  opts: { allowCodeChanges: boolean },
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const pkgPath = join(workDir, 'package.json');
  const lockPath = join(workDir, 'package-lock.json');
  const pkg = await readJson<Record<string, any>>(pkgPath);
  const lock = await readJson<PackageLock>(lockPath);

  for (const step of steps) {
    if (step.action === 'bump-direct' && step.name && step.to) {
      if (!pkg.dependencies?.[step.name]) { skipped.push(`bump ${step.name}: not a direct dependency`); continue; }
      pkg.dependencies[step.name] = step.to;
      setLocked(lock, step.name, step.to);
      applied.push(`bump ${step.name} -> ${step.to}`);
    } else if (step.action === 'override' && step.name && step.to) {
      pkg.overrides = { ...(pkg.overrides ?? {}), [step.name]: step.to };
      setLocked(lock, step.name, step.to);
      applied.push(`override ${step.name} -> ${step.to}`);
    } else if (step.action === 'add-verify-options') {
      if (!opts.allowCodeChanges) { skipped.push('add algorithms option: code changes not allowed'); continue; }
      const changed = await addAlgorithmsToVerify(workDir);
      applied.push(changed > 0 ? `add algorithms option in ${changed} file(s)` : 'add algorithms option: no verify calls found');
    }
  }
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { applied, skipped };
}

function setLocked(lock: PackageLock, name: string, version: string): void {
  lock.packages[`node_modules/${name}`] = { ...(lock.packages[`node_modules/${name}`] ?? {}), version };
}

async function addAlgorithmsToVerify(workDir: string): Promise<number> {
  let changed = 0;
  for (const file of await listFiles(join(workDir, 'src'))) {
    const src = await readFile(file, 'utf8');
    if (!src.includes('verify(')) continue;
    const next = src.replace(/verify\(([^,()]+),\s*([^,()]+)\)/g, "verify($1, $2, { algorithms: ['HS256'] })");
    if (next !== src) { await writeFile(file, next); changed++; }
  }
  return changed;
}

/** Simulated build + test: evaluates the deterministic rules in bloodhound.test.json against the work tree. */
export async function simulateTests(workDir: string): Promise<TestResult> {
  const rules = await readJson<TestRules>(join(workDir, 'bloodhound.test.json'));
  const lock = await readJson<PackageLock>(join(workDir, 'package-lock.json'));
  const checks: TestResult['checks'] = [];
  for (const [name, range] of Object.entries(rules.greenWhen ?? {})) {
    const installed = lock.packages[`node_modules/${name}`]?.version;
    if (installed === undefined) { checks.push({ name: `dependency ${name}`, ok: true, detail: 'not installed, nothing to check' }); continue; }
    const ok = satisfiesRange(installed, range);
    checks.push({ name: `dependency ${name}`, ok, detail: `${installed} ${ok ? 'satisfies' : 'does not satisfy'} ${range}` });
  }
  for (const check of rules.codeChecks ?? []) {
    const path = join(workDir, check.file);
    const src = existsSync(path) ? await readFile(path, 'utf8') : '';
    const ok = !src.includes(check.pattern) || src.includes(check.mustAlso);
    checks.push({ name: `code ${check.file}`, ok, detail: ok ? `"${check.pattern}" is guarded by "${check.mustAlso}"` : `"${check.pattern}" without "${check.mustAlso}"` });
  }
  return { green: checks.every((c) => c.ok), checks };
}

/** Unified-style diff of every file that differs between the mock repo and the work tree. */
export async function diffWorkdir(sourceDir: string, workDir: string): Promise<string> {
  const before = await snapshot(sourceDir);
  const after = await snapshot(workDir);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const out: string[] = [];
  for (const p of paths) {
    const a = before.get(p) ?? '';
    const b = after.get(p) ?? '';
    if (a === b) continue;
    out.push(`--- a/${p}`, `+++ b/${p}`, ...lineDiff(a.split('\n'), b.split('\n')));
  }
  return out.join('\n');
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const f of await listFiles(dir)) {
    if (f.endsWith('bloodhound.test.json')) continue;
    map.set(relative(dir, f).split('\\').join('/'), await readFile(f, 'utf8'));
  }
  return map;
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

/** LCS-based line diff; the files here are small. */
export function lineDiff(a: string[], b: string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(` ${a[i]}`); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`-${a[i]}`); i++; }
    else { out.push(`+${b[j]}`); j++; }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out;
}
