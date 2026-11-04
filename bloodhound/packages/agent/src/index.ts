// LLM access for Bloodhound. Three modes, set by BLOODHOUND_LLM:
//   live    : call the API, record the answer as a fixture in fixtures/llm/
//   replay  : use recorded fixtures only (default, deterministic, offline)
//   off     : no model calls at all
// When no fixture exists in replay mode, callers get { source: 'fallback' } and use their deterministic template.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

/** The only model this system calls. Every task uses it; callJson refuses anything else. */
export const ALLOWED_MODEL = 'claude-haiku-5-5';
export const MODELS = {
  reasoning: ALLOWED_MODEL, // grouping rationale, recipes, learnings (Haiku only)
  light: ALLOWED_MODEL, // customer text drafts
} as const;

export type Mode = 'live' | 'replay' | 'off';
/** Repo root = the folder with pnpm-workspace.yaml, so fixtures land in one place whatever the caller's cwd is. */
function repoRoot(start: string): string {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
  return dir;
}
export const FIXTURE_DIR = join(repoRoot(process.cwd()), 'fixtures', 'llm');

export interface CallResult<T> {
  value: T | null;
  source: 'live' | 'fixture' | 'fallback';
}

export interface Stats {
  calls: number;
  live: number;
  fixture: number;
  fallback: number;
  inputChars: number;
  outputChars: number;
}

export const stats: Stats = { calls: 0, live: 0, fixture: 0, fallback: 0, inputChars: 0, outputChars: 0 };

export function currentMode(): Mode {
  const m = (process.env.BLOODHOUND_LLM ?? 'replay') as Mode;
  return m === 'live' || m === 'off' ? m : 'replay';
}

function keyFor(task: string, model: string, prompt: string): string {
  return createHash('sha256').update(`${task}\n${model}\n${prompt}`).digest('hex').slice(0, 24);
}

/**
 * Runs one structured call. The answer must be a JSON object and pass `validate`.
 * Invalid JSON or a wrong shape counts as no answer, so the caller falls back to its template.
 */
export async function callJson<T>(opts: {
  task: string;
  model: keyof typeof MODELS;
  system: string;
  prompt: string;
  validate: (value: unknown) => value is T;
}): Promise<CallResult<T>> {
  stats.calls++;
  const model = MODELS[opts.model];
  if (model !== ALLOWED_MODEL) throw new Error(`model ${model} is not allowed; only ${ALLOWED_MODEL}`);
  const key = keyFor(opts.task, model, opts.prompt);
  const fixturePath = join(FIXTURE_DIR, `${opts.task}-${key}.json`);
  const mode = currentMode();
  stats.inputChars += opts.prompt.length;

  if (mode === 'replay' || mode === 'live') {
    if (mode === 'replay' && existsSync(fixturePath)) {
      stats.fixture++;
      const recorded = JSON.parse(readFileSync(fixturePath, 'utf8')) as { output: unknown };
      if (opts.validate(recorded.output)) return { value: recorded.output, source: 'fixture' };
      stats.fallback++;
      return { value: null, source: 'fallback' };
    }
  }

  if (mode === 'live' && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let text = '';
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 1200,
        system: `${opts.system}\nAnswer with one JSON object only, no prose around it.`,
        messages: [{ role: 'user', content: opts.prompt }],
      });
      text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    } catch (err) {
      // API error: log only the error class (never the key), then use the template.
      console.warn(`[bloodhound] model call ${opts.task} failed: ${(err as Error).name}; using template`);
    }
    stats.outputChars += text.length;
    const json = text ? extractJson(text) : null;
    if (json !== null && opts.validate(json)) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(fixturePath, JSON.stringify({ task: opts.task, model, input: opts.prompt, output: json }, null, 2));
      stats.live++;
      return { value: json as T, source: 'live' };
    }
    if (text) console.warn(`[bloodhound] model answer for ${opts.task} did not match the expected shape; using template. Answer began: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  }

  stats.fallback++;
  return { value: null, source: 'fallback' };
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
export * from './tasks';
