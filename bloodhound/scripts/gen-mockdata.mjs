// Generates the deterministic mock world under mockdata/.
// Run once (or after changing the world): node scripts/gen-mockdata.mjs
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'mockdata');
if (existsSync(join(root, 'repos'))) rmSync(join(root, 'repos'), { recursive: true });
mkdirSync(join(root, 'repos'), { recursive: true });
mkdirSync(join(root, 'incidents'), { recursive: true });
const write = (p, data) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};

// ---------- projects & environments ----------
const projects = [
  { id: 'webshop', name: 'Webshop', ownerTeam: 'Team Commerce' },
  { id: 'billing', name: 'Billing', ownerTeam: 'Team Payments' },
  { id: 'portal', name: 'Kundenportal', ownerTeam: 'Team Portal' },
  { id: 'logistics', name: 'Logistik', ownerTeam: 'Team Supply' },
];
const envs = [];
for (const p of projects) {
  [['dev', 1, 168], ['staging', 2, 72], ['prod', 3, 48]].forEach(([name, pos, floor]) => {
    envs.push({
      id: `${p.id}-${name}`, projectId: p.id, name, pipelinePos: pos,
      rules: { slackChannel: `#sec-${p.id}-${name}`, pagingPolicy: name === 'prod' ? 'page-on-call' : 'ticket-only', slaFloorHours: floor },
    });
  });
}

// ---------- customers (12) ----------
const TIERS = {
  gold: { CRITICAL: 24, HIGH: 48, MEDIUM: 120, LOW: 336 },
  silver: { CRITICAL: 48, HIGH: 96, MEDIUM: 168, LOW: 504 },
  standard: { CRITICAL: 72, HIGH: 168, MEDIUM: 336, LOW: 720 },
};
const customerDefs = [
  ['C01', 'Nordlicht Handel', 'gold', ['webshop-prod', 'webshop-staging', 'logistics-prod']],
  ['C02', 'Bäckerei Krüger', 'standard', ['webshop-prod']],
  ['C03', 'Stadtwerke Lindau', 'silver', ['webshop-prod', 'billing-prod']],
  ['C04', 'Aurora Versicherung', 'gold', ['billing-prod']],
  ['C05', 'Mobilfunk Ost', 'silver', ['billing-prod']],
  ['C06', 'Klinikverbund Rhein', 'gold', ['portal-prod']],
  ['C07', 'Schulverband Nord', 'standard', ['portal-prod']],
  ['C08', 'Hansa Logistik', 'silver', ['logistics-prod', 'logistics-staging']],
  ['C09', 'Frachtwerk Süd', 'standard', ['logistics-prod']],
  ['C10', 'Stadtbibliothek Weiden', 'standard', ['portal-prod']],
  ['C11', 'Energiehaus Mitte', 'silver', ['webshop-staging']],
  ['C12', 'Vogelsang Reisen', 'standard', ['webshop-prod']],
];
const customers = customerDefs.map(([id, name, tier, envIds]) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id, name, tier, slaHours: TIERS[tier],
    contacts: [{ name: `IT-Leitung ${name}`, email: `ops@${slug}.example.com` }],
    optInNotAffected: id === 'C01',
    environments: envIds,
  };
});

// ---------- repos ----------
// lock = resolved versions (main). deployments = per env overrides of the lock (what is actually running).
const verifyWithAlgorithms = `const jwt = require('jsonwebtoken');\nconst KEY = process.env.JWT_KEY;\n\nmodule.exports = function verifyToken(token) {\n  return jwt.verify(token, KEY, { algorithms: ['HS256'] });\n};\n`;
const verifyWithoutAlgorithms = `const jwt = require('jsonwebtoken');\nconst KEY = process.env.JWT_KEY;\n\nmodule.exports = function verifyToken(token) {\n  return jwt.verify(token, KEY);\n};\n`;
const expressJwtWithAlgorithms = `const expressJwt = require('express-jwt');\n\nmodule.exports = expressJwt({ secret: process.env.JWT_KEY, algorithms: ['HS256'] });\n`;

const repos = [
  {
    id: 'shop-api', name: 'shop-api', projectId: 'webshop', framework: 'express',
    direct: { express: '4.18.2', jsonwebtoken: '8.5.1' },
    lock: { express: '4.18.2', jsonwebtoken: '8.5.1' },
    deployments: { 'webshop-staging': {}, 'webshop-prod': {} },
    files: { 'src/auth.js': verifyWithAlgorithms, 'src/index.js': `const express = require('express');\nconst app = express();\napp.listen(3000);\n` },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [{ file: 'src/auth.js', pattern: 'verify(', mustAlso: 'algorithms' }] },
  },
  {
    id: 'shop-web', name: 'shop-web', projectId: 'webshop', framework: 'next',
    direct: { next: '14.2.3', jsonwebtoken: '^8.5.1' },
    lock: { next: '14.2.3', jsonwebtoken: '8.5.1' },
    deployments: { 'webshop-prod': {} },
    files: { 'src/session.js': `const jwt = require('jsonwebtoken');\nmodule.exports = (t) => jwt.decode(t);\n` },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [] },
  },
  {
    id: 'billing-api', name: 'billing-api', projectId: 'billing', framework: 'express',
    direct: { express: '4.18.2', 'express-jwt': '6.0.0' },
    lock: { express: '4.18.2', 'express-jwt': '6.0.0', jsonwebtoken: '8.5.0' },
    deployments: { 'billing-staging': {}, 'billing-prod': {} },
    files: { 'src/auth.js': expressJwtWithAlgorithms },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [{ file: 'src/auth.js', pattern: 'expressJwt(', mustAlso: 'algorithms' }] },
  },
  {
    id: 'billing-worker', name: 'billing-worker', projectId: 'billing', framework: 'node',
    direct: { jsonwebtoken: '8.5.1', bullmq: '5.12.0' },
    lock: { jsonwebtoken: '8.5.1', bullmq: '5.12.0' },
    deployments: { 'billing-staging': {} },
    files: { 'src/worker.js': `const jwt = require('jsonwebtoken');\nmodule.exports = (payload) => jwt.sign(payload, process.env.JWT_KEY);\n` },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [] },
  },
  {
    id: 'portal-auth', name: 'portal-auth', projectId: 'portal', framework: 'express',
    direct: { express: '4.18.2', jsonwebtoken: '9.0.0' },
    lock: { express: '4.18.2', jsonwebtoken: '9.0.0' },
    deployments: { 'portal-dev': {}, 'portal-prod': { jsonwebtoken: '8.5.1' } },
    files: { 'src/auth.js': verifyWithAlgorithms },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [{ file: 'src/auth.js', pattern: 'verify(', mustAlso: 'algorithms' }] },
  },
  {
    id: 'portal-frontend', name: 'portal-frontend', projectId: 'portal', framework: 'react',
    direct: { react: '18.3.1', lodash: '4.17.21' },
    lock: { react: '18.3.1', lodash: '4.17.21' },
    deployments: { 'portal-prod': {} },
    files: { 'src/app.js': `const _ = require('lodash');\nmodule.exports = (xs) => _.uniq(xs);\n` },
    test: { greenWhen: { lodash: '>=4.17.21' }, codeChecks: [] },
  },
  {
    id: 'legacy-cms', name: 'legacy-cms', projectId: 'portal', framework: 'express',
    direct: { express: '4.17.1', jsonwebtoken: '7.4.0' },
    lock: { express: '4.17.1', jsonwebtoken: '7.4.0' },
    deployments: { 'portal-prod': {} },
    files: { 'src/auth.js': verifyWithoutAlgorithms },
    test: { greenWhen: { jsonwebtoken: '>=9.0.0' }, codeChecks: [{ file: 'src/auth.js', pattern: 'verify(', mustAlso: 'algorithms' }] },
  },
  {
    id: 'logistics-tracker', name: 'logistics-tracker', projectId: 'logistics', framework: 'express',
    direct: { express: '4.18.2', lodash: '4.17.20' },
    lock: { express: '4.18.2', lodash: '4.17.20' },
    deployments: { 'logistics-prod': {} },
    files: { 'src/track.js': `const _ = require('lodash');\nmodule.exports = (events) => _.sortBy(events, 'ts');\n` },
    test: { greenWhen: { lodash: '>=4.17.21' }, codeChecks: [] },
  },
  {
    id: 'logistics-notify', name: 'logistics-notify', projectId: 'logistics', framework: 'node',
    direct: { lodash: '4.17.21', nodemailer: '6.9.13' },
    lock: { lodash: '4.17.21', nodemailer: '6.9.13' },
    deployments: { 'logistics-staging': { lodash: '4.17.19' }, 'logistics-prod': {} },
    files: { 'src/notify.js': `const _ = require('lodash');\nmodule.exports = (xs) => _.compact(xs);\n` },
    test: { greenWhen: { lodash: '>=4.17.21' }, codeChecks: [] },
  },
  {
    id: 'reports-service', name: 'reports-service', projectId: 'logistics', framework: 'node',
    direct: { 'pdf-parse-lite': '1.4.0' },
    lock: { 'pdf-parse-lite': '1.4.0' },
    deployments: { 'logistics-prod': {} },
    files: { 'src/report.js': `const pdf = require('pdf-parse-lite');\nmodule.exports = (buf) => pdf(buf);\n` },
    test: { greenWhen: {}, codeChecks: [] },
  },
];

const repoIndex = [];
for (const r of repos) {
  const dir = join(root, 'repos', r.id);
  const pkg = {
    name: r.name, version: '1.0.0', private: true,
    dependencies: r.direct,
  };
  // Transitive deps need an explicit override on the root, which the recipe will add/change later.
  write(join(dir, 'package.json'), pkg);
  const packages = { '': { name: r.name, version: '1.0.0', dependencies: r.direct } };
  for (const [name, version] of Object.entries(r.lock)) {
    packages[`node_modules/${name}`] = { version, resolved: `https://registry.example.com/${name}/-/${name}-${version}.tgz` };
  }
  write(join(dir, 'package-lock.json'), { name: r.name, version: '1.0.0', lockfileVersion: 3, requires: true, packages });
  for (const [f, content] of Object.entries(r.files)) write(join(dir, f), content);
  write(join(dir, 'bloodhound.test.json'), { description: `Simulated test rules for ${r.id}`, ...r.test });
  const direct = Object.keys(r.direct);
  const deployedVersions = {};
  for (const envId of Object.keys(r.deployments)) {
    deployedVersions[envId] = { ...r.lock, ...r.deployments[envId] };
  }
  repoIndex.push({
    id: r.id, projectId: r.projectId, framework: r.framework, dirPath: `mockdata/repos/${r.id}`,
    envIds: Object.keys(r.deployments), direct, deployedVersions,
  });
}

// ---------- releases (what each environment runs) ----------
const releases = {};
for (const env of envs) {
  const versions = {};
  for (const r of repoIndex) {
    if (r.deployedVersions[env.id]) versions[r.id] = r.deployedVersions[env.id];
  }
  releases[env.id] = {
    release: `${env.projectId}-${env.name}-2026.10.${String(env.pipelinePos + 2).padStart(2, '0')}`,
    deployedAt: '2026-10-28T09:00:00Z',
    versions,
  };
}

// ---------- incidents (OSV-style) ----------
const osv = (id, summary, pkg, introduced, fixed, sev, detectedAt) => ({
  id, summary, detectedAt,
  severity: sev,
  database_specific: { severity: sev },
  affected: [{
    package: { ecosystem: 'npm', name: pkg },
    ranges: [{ type: 'SEMVER', events: [{ introduced }, ...(fixed ? [{ fixed }] : [])] }],
  }],
});
const incidents = [
  osv('OSV-2026-1001', 'jsonwebtoken: forged tokens accepted when algorithm is not pinned', 'jsonwebtoken', '0', '9.0.0', 'CRITICAL', '2026-11-04T08:00:00Z'),
  osv('OSV-2026-1002', 'lodash: prototype pollution in merge helpers', 'lodash', '0', '4.17.21', 'HIGH', '2026-11-04T09:30:00Z'),
  osv('OSV-2026-1003', 'jsonwebtoken: weak verification default (second report)', 'jsonwebtoken', '0', '9.0.0', 'HIGH', '2026-11-04T13:00:00Z'),
  osv('OSV-2026-1004', 'pdf-parse-lite: unbounded memory use on crafted PDFs; no fixed release yet', 'pdf-parse-lite', '0', null, 'MEDIUM', '2026-11-04T14:00:00Z'),
];
incidents.forEach((inc, i) => write(join(root, 'incidents', `${String(i + 1).padStart(2, '0')}-${inc.id}.json`), inc));

write(join(root, 'projects.json'), { projects, environments: envs, repos: repoIndex.map(({ deployedVersions, ...r }) => r) });
write(join(root, 'customers.json'), customers);
write(join(root, 'releases.json'), releases);
console.log(`mockdata written: ${projects.length} projects, ${envs.length} envs, ${customers.length} customers, ${repos.length} repos, ${incidents.length} incidents`);
