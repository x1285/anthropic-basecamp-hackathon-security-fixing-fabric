// How repos enter the world: generated fake repos (with realistic version mixes) and pasted manifests.
import type { Dep, Eco, Environment, Repo, Tests } from './model';

const POOL: Record<Eco, { n: string; v: string[]; via?: string }[]> = {
  npm: [
    { n: 'express', v: ['4.17.1', '4.18.2', '4.19.2'] },
    { n: 'qs', v: ['6.7.0', '6.11.0'], via: 'express' },
    { n: 'body-parser', v: ['1.19.0', '1.20.1'], via: 'express' },
    { n: 'lodash', v: ['4.17.15', '4.17.19', '4.17.21'] },
    { n: 'axios', v: ['0.21.1', '1.6.0', '1.7.4'] },
    { n: 'follow-redirects', v: ['1.14.7', '1.15.6'], via: 'axios' },
    { n: 'jsonwebtoken', v: ['8.5.1', '9.0.2'] },
    { n: 'semver', v: ['7.3.5', '7.5.4'], via: 'jsonwebtoken' },
    { n: 'ws', v: ['7.4.5', '8.17.1'] },
    { n: 'moment', v: ['2.29.1', '2.29.4'] },
    { n: 'react', v: ['18.2.0', '18.3.1'] },
    { n: 'next', v: ['13.4.0', '14.2.10'] },
    { n: 'minimist', v: ['1.2.5', '1.2.8'] },
  ],
  PyPI: [
    { n: 'django', v: ['3.2.4', '4.2.11', '5.0.6'] },
    { n: 'requests', v: ['2.25.1', '2.31.0', '2.32.3'] },
    { n: 'urllib3', v: ['1.26.4', '1.26.18', '2.2.2'], via: 'requests' },
    { n: 'certifi', v: ['2021.5.30', '2024.7.4'], via: 'requests' },
    { n: 'flask', v: ['2.0.1', '3.0.3'] },
    { n: 'jinja2', v: ['3.0.1', '3.1.4'], via: 'flask' },
    { n: 'werkzeug', v: ['2.0.1', '3.0.3'], via: 'flask' },
    { n: 'pyyaml', v: ['5.3.1', '6.0.1'] },
    { n: 'pillow', v: ['8.2.0', '10.3.0'] },
    { n: 'cryptography', v: ['3.4.7', '42.0.5'] },
    { n: 'fastapi', v: ['0.95.0', '0.111.0'] },
    { n: 'starlette', v: ['0.26.1', '0.37.2'], via: 'fastapi' },
    { n: 'numpy', v: ['1.21.0', '1.26.4'] },
  ],
  Go: [
    { n: 'github.com/gin-gonic/gin', v: ['v1.7.2', 'v1.9.1'] },
    { n: 'golang.org/x/net', v: ['v0.7.0', 'v0.17.0', 'v0.23.0'], via: 'github.com/gin-gonic/gin' },
    { n: 'gopkg.in/yaml.v3', v: ['v3.0.0', 'v3.0.1'], via: 'github.com/gin-gonic/gin' },
    { n: 'google.golang.org/grpc', v: ['v1.56.2', 'v1.58.3'] },
    { n: 'google.golang.org/protobuf', v: ['v1.30.0', 'v1.33.0'], via: 'google.golang.org/grpc' },
    { n: 'github.com/golang-jwt/jwt/v4', v: ['v4.4.1', 'v4.5.0'] },
    { n: 'golang.org/x/crypto', v: ['v0.14.0', 'v0.21.0'] },
    { n: 'github.com/redis/go-redis/v9', v: ['v9.0.5', 'v9.5.1'] },
  ],
};

export const NAME_A = ['billing', 'inventory', 'search', 'auth', 'notifications', 'reporting', 'catalog', 'shipping', 'pricing', 'loyalty'];
export const NAME_B = ['service', 'api', 'worker', 'web', 'gateway', 'jobs'];
export const ECO_NAMES: Eco[] = ['npm', 'PyPI', 'Go'];

/** Random-but-plausible repo: a few direct deps, some transitive ones, some environments behind main. */
export function fakeRepo(id: string, name: string, eco: Eco, envs: Environment[], rng: () => number): Repo {
  const pool = POOL[eco];
  const pick = <T,>(a: T[]): T => a[Math.floor(rng() * a.length)]!;
  const directs = [...pool.filter((p) => !p.via)].sort(() => rng() - 0.5).slice(0, 3 + Math.floor(rng() * 3));
  const names = new Set(directs.map((d) => d.n));
  const chosen = [...directs, ...pool.filter((p) => p.via && names.has(p.via) && rng() < 0.9)];
  const deps: Dep[] = chosen.map((p) => {
    const i = Math.floor(rng() * p.v.length);
    const d: Dep = { name: p.n, version: p.v[i]!, direct: !p.via, via: p.via ?? '', env: {} };
    if (i > 0 && rng() < 0.45) {
      const older = p.v[Math.floor(rng() * i)]!;
      const last = envs[envs.length - 1];
      if (last) d.env[last.id] = older;
      if (envs.length > 2 && rng() < 0.5) d.env[envs[envs.length - 2]!.id] = older;
    }
    return d;
  });
  const deployed: Record<string, boolean> = {}, releases: Record<string, string> = {};
  const major = 1 + Math.floor(rng() * 4), minor = Math.floor(rng() * 9);
  envs.forEach((e, i) => {
    deployed[e.id] = true;
    releases[e.id] = i === 0 ? 'main@' + rng().toString(16).slice(2, 8) : `v${major}.${Math.max(0, minor - (envs.length - 1 - i))}.${Math.floor(rng() * 6)}`;
  });
  const tests: Tests = pick<Tests>(['good', 'some', 'none']);
  return { id, name, ecosystem: eco, watched: true, source: 'fake', tests, deployed, releases, deps };
}

export interface ParsedManifest {
  ecosystem: Eco;
  deps: Dep[];
  guessName: string;
}

/** Reads package.json, package-lock.json, requirements.txt or go.mod. Throws a readable message when nothing usable is found. */
export function parseManifest(text: string): ParsedManifest {
  const t = text.trim();
  if (!t) throw new Error('Paste the contents of a package.json, package-lock.json, requirements.txt or go.mod.');
  if (t.startsWith('{')) {
    let j: any;
    try { j = JSON.parse(t); } catch { throw new Error('That looks like JSON but doesn’t parse. Check for a missing comma or bracket.'); }
    if (j.packages && typeof j.packages === 'object') {
      const root = j.packages[''];
      const rootDeps = new Set(Object.keys({ ...(root?.dependencies ?? {}), ...(root?.devDependencies ?? {}) }));
      const deps: Dep[] = [];
      for (const [path, info] of Object.entries<any>(j.packages)) {
        if (!path || !info.version) continue;
        const segs = path.split('node_modules/').filter(Boolean).map((s) => s.replace(/\/$/, ''));
        const name = segs[segs.length - 1]!;
        const direct = segs.length === 1 && rootDeps.has(name);
        deps.push({ name, version: info.version, direct, via: direct ? '' : (segs.length > 1 ? segs[segs.length - 2]! : 'lockfile'), env: {} });
      }
      if (!deps.length) throw new Error('The lockfile has no packages in it.');
      return { ecosystem: 'npm', deps, guessName: j.name ?? '' };
    }
    const all = { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) } as Record<string, string>;
    const deps: Dep[] = Object.entries(all).map(([name, version]) => ({ name, version: String(version), direct: true, via: '', env: {} }));
    if (!deps.length) throw new Error('This package.json has no dependencies or devDependencies.');
    return { ecosystem: 'npm', deps, guessName: j.name ?? '' };
  }
  if (/^\s*module\s+\S+/m.test(t) || /^\s*require\s*[(\s]/m.test(t)) {
    const deps: Dep[] = [];
    const mod = t.match(/^\s*module\s+(\S+)/m)?.[1];
    for (const line of t.split('\n')) {
      const m = line.match(/^\s*(?:require\s+)?([\w.\-~]+\.[\w.\-~/]+)\s+(v[\w.\-+]+)(.*)$/);
      if (m && m[1] !== 'module') {
        const indirect = /\/\/\s*indirect/.test(m[3] ?? '');
        deps.push({ name: m[1]!, version: m[2]!, direct: !indirect, via: indirect ? 'indirect' : '', env: {} });
      }
    }
    if (!deps.length) throw new Error('No require lines found in this go.mod.');
    return { ecosystem: 'Go', deps, guessName: mod ? mod.split('/').pop() ?? '' : '' };
  }
  const deps: Dep[] = [];
  for (const raw of t.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(?:(===|==|>=|~=|<=|>|<|!=)\s*([\w.\-*+!]+))?/);
    if (m) {
      const version = m[3] ? (m[2] === '==' || m[2] === '===' ? m[3] : m[2] + m[3]) : 'unpinned';
      deps.push({ name: m[1]!, version, direct: true, via: '', env: {} });
    }
  }
  if (!deps.length) throw new Error('Couldn’t find any dependencies. Supported: package.json, package-lock.json, requirements.txt, go.mod.');
  return { ecosystem: 'PyPI', deps, guessName: '' };
}
