// The concrete agent tasks. Each returns a model answer when it has the expected shape, otherwise a deterministic template.
// All tasks run on claude-haiku-5-5 (see ALLOWED_MODEL in index.ts).
import { callJson, type CallResult } from './index';

export interface RecipeStep {
  action: 'bump-direct' | 'override' | 'add-verify-options';
  name?: string;
  to?: string;
}

export interface RecipeDraft {
  strategy: string;
  steps: RecipeStep[];
  breaking: string[];
  verification: string[];
  confidence: number;
}

export interface GroupInput {
  signature: string;
  packageName: string;
  fixedVersion: string;
  strategy: 'direct' | 'transitive';
  repos: Array<{ id: string; version: string; scopes: string[] }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isConfidence = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const STEP_ACTIONS = ['bump-direct', 'override', 'add-verify-options'];

export function isRecipeDraft(v: unknown): v is RecipeDraft {
  return (
    isObj(v) &&
    typeof v.strategy === 'string' &&
    Array.isArray(v.steps) &&
    v.steps.every((s) => isObj(s) && STEP_ACTIONS.includes(s.action as string)) &&
    isStrings(v.breaking) &&
    isStrings(v.verification) &&
    isConfidence(v.confidence)
  );
}

function isRationale(v: unknown): v is { rationale: string; confidence: number } {
  return isObj(v) && typeof v.rationale === 'string' && v.rationale.length > 0 && isConfidence(v.confidence);
}

function isBody(v: unknown): v is { body: string } {
  return isObj(v) && typeof v.body === 'string' && v.body.length > 0;
}

function isLearning(v: unknown): v is { learning: string } {
  return isObj(v) && typeof v.learning === 'string' && v.learning.length > 0;
}

/** Recipe draft for one fix signature. Reused from memory when the signature is known. */
export async function draftRecipe(input: GroupInput): Promise<CallResult<RecipeDraft> & { value: RecipeDraft }> {
  const res = await callJson<RecipeDraft>({
    task: 'recipe',
    model: 'reasoning',
    system:
      'You write dependency fix recipes for a security incident. Answer with exactly this JSON shape and nothing else: ' +
      '{"strategy": string, "steps": [{"action": "bump-direct" | "override" | "add-verify-options", "name"?: string, "to"?: string}], ' +
      '"breaking": string[], "verification": string[], "confidence": number between 0 and 1}. ' +
      'Use "bump-direct" with name and to for direct dependencies, "override" with name and to for transitive ones, ' +
      'and "add-verify-options" without name or to where verify() calls need an algorithms option.',
    prompt: JSON.stringify({ signature: input.signature, package: input.packageName, fixedVersion: input.fixedVersion, strategy: input.strategy, repos: input.repos }),
    validate: isRecipeDraft,
  });
  if (res.value) return { ...res, value: res.value };
  const steps: RecipeStep[] =
    input.strategy === 'direct'
      ? [{ action: 'bump-direct', name: input.packageName, to: input.fixedVersion }]
      : [{ action: 'override', name: input.packageName, to: input.fixedVersion }];
  if (input.packageName === 'jsonwebtoken') steps.push({ action: 'add-verify-options' });
  const value: RecipeDraft = {
    strategy:
      input.strategy === 'direct'
        ? `Bump ${input.packageName} to ${input.fixedVersion} in package.json`
        : `Pin ${input.packageName} to ${input.fixedVersion} with an override, since it comes in transitively`,
    steps,
    breaking: input.packageName === 'jsonwebtoken' ? ['verify() without an algorithms option is rejected by the fixed major'] : [],
    verification: [`${input.packageName} resolves to >= ${input.fixedVersion}`, 'existing tests are green', 'verify calls pin algorithms'],
    confidence: input.strategy === 'direct' ? 0.9 : 0.75,
  };
  return { value, source: 'fallback' };
}

export interface RationaleOut {
  rationale: string;
  confidence: number;
}

export async function groupRationale(input: GroupInput): Promise<RationaleOut> {
  const res = await callJson<RationaleOut>({
    task: 'grouping',
    model: 'reasoning',
    system: 'You explain why a set of repos needs the same dependency fix. Keep it to two sentences. Answer as {"rationale": string, "confidence": number 0-1}.',
    prompt: JSON.stringify(input),
    validate: isRationale,
  });
  if (res.value) return res.value;
  const n = input.repos.length;
  return {
    rationale: `${n} repo(s) pull ${input.packageName} ${input.strategy === 'direct' ? 'as a direct dependency' : 'transitively'} on a vulnerable version. They share the same target ${input.fixedVersion}, so one recipe covers them.`,
    confidence: input.strategy === 'direct' ? 0.9 : 0.8,
  };
}

export interface NoticeInput {
  incidentId: string;
  packageName: string;
  severity: string;
  envNames: string[];
  slaHours: number;
}

export async function noticeDraft(input: NoticeInput): Promise<string> {
  const res = await callJson<{ body: string }>({
    task: 'notice',
    model: 'light',
    system: 'You write short, factual security notices to customers in German. Never include customer names or contact data. Answer as {"body": string}.',
    prompt: JSON.stringify(input),
    validate: isBody,
  });
  if (res.value) return res.value.body;
  return [
    `Sicherheitshinweis zu ${input.packageName} (${input.incidentId}, Schweregrad ${input.severity}).`,
    `Betroffen sind Ihre Umgebungen: ${input.envNames.join(', ')}.`,
    `Wir arbeiten an einer Korrektur. Unser Ziel ist, alle betroffenen Umgebungen innerhalb von ${input.slaHours} Stunden zu prüfen und zu schließen.`,
    'Wir informieren Sie, sobald die Korrektur verifiziert ist.',
  ].join(' ');
}

/** Local personalisation (no customer data goes to the model, see decisions D8). */
export function personalize(body: string, customerName: string, envNames: string[]): string {
  return `Guten Tag ${customerName},\n\n${body}\n\nIhre betroffenen Umgebungen: ${envNames.join(', ')}.`;
}

export interface LearningInput {
  signature: string;
  repoId: string;
  outcome: 'green' | 'red';
  failedChecks: string[];
}

/** One learning line for the recipe's log, written after every repo. */
export async function learningNote(input: LearningInput): Promise<string> {
  const res = await callJson<{ learning: string }>({
    task: 'learning',
    model: 'reasoning',
    system: 'Summarise what one repo taught about the fix recipe in one sentence. Answer as {"learning": string}.',
    prompt: JSON.stringify(input),
    validate: isLearning,
  });
  if (res.value) return res.value.learning;
  if (input.outcome === 'green') return `${input.repoId}: recipe applied, all simulated checks green.`;
  return `${input.repoId}: recipe failed (${input.failedChecks.join('; ')}).`;
}
