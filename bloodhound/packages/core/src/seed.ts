// Demo world and incident presets. Mirrors the seed of the target UI (Bloodhound.html) so both show the same data.
import type { Customer, Environment, Incident, Project, Repo, Sla, Tier, World } from './model';
import type { Dep } from './model';

export const TIERS: Record<Tier, Sla> = {
  Gold: { critical: 4, high: 24, medium: 72, low: 168 },
  Silver: { critical: 8, high: 48, medium: 120, low: 336 },
  Standard: { critical: 24, high: 72, medium: 168, low: null },
};

export const SEED_ENVS = (): Environment[] => [
  { id: 'dev', name: 'dev', sla: { critical: 72, high: 168, medium: null, low: null }, ticket: false, slack: false, channel: '#team-dev', page: 'never' },
  { id: 'staging', name: 'staging', sla: { critical: 24, high: 72, medium: 168, low: null }, ticket: true, slack: true, channel: '#releases', page: 'never' },
  { id: 'prod', name: 'prod', sla: { critical: 4, high: 24, medium: 72, low: 168 }, ticket: true, slack: true, channel: '#sec-incidents', page: 'high' },
];

export const PRESETS: Incident[] = [
  { id: 'DEMO-2026-0104', severity: 'critical', ecosystem: 'npm', package: 'jsonwebtoken', introduced: '0', fixed: '9.0.0',
    summary: 'jsonwebtoken accepts tokens signed with the wrong key type',
    details: 'Insecure defaults allow an attacker to forge tokens by switching the algorithm.' },
  { id: 'DEMO-2026-0101', severity: 'high', ecosystem: 'npm', package: 'lodash', introduced: '0', fixed: '4.17.21',
    summary: 'Prototype pollution in lodash merge functions',
    details: 'Crafted input to merge, mergeWith and defaultsDeep can add properties to Object.prototype.' },
  { id: 'DEMO-2026-0102', severity: 'medium', ecosystem: 'PyPI', package: 'urllib3', introduced: '1.0.0', fixed: '1.26.18',
    summary: 'urllib3 keeps sensitive headers on cross-origin redirects',
    details: 'Cookie headers are forwarded when following a redirect to a different host.' },
  { id: 'DEMO-2026-0103', severity: 'high', ecosystem: 'Go', package: 'golang.org/x/net', introduced: '0', fixed: '0.17.0',
    summary: 'HTTP/2 rapid stream resets exhaust server resources',
    details: 'A client can open and cancel streams quickly to cause denial of service.' },
  { id: 'DEMO-2026-0105', severity: 'low', ecosystem: 'npm', package: 'left-pad', introduced: '0', fixed: '1.3.1',
    summary: 'left-pad mishandles very long padding strings',
    details: 'Used to show a run where every repo comes back clear.' },
];

/** Chip labels of the incident lab, in the same order as PRESETS. */
export const PRESET_LABELS = [
  'jsonwebtoken key confusion', 'lodash prototype pollution', 'urllib3 header leak', 'x/net HTTP/2 reset flood', 'No repo uses this',
];

/** The lab form starts with the first preset. */
export const DEMO_DRAFT: Incident = { ...PRESETS[0]! };

export function seedWorld(): World {
  const envs = SEED_ENVS();
  const customer = (id: string, name: string, tier: Tier, contact: string, notifyUnaffected = false): Customer =>
    ({ id, name, tier, sla: { ...TIERS[tier] }, contact, notifyUnaffected });
  const customers: Customer[] = [
    customer('contoso', 'Contoso', 'Gold', 'security@contoso.example'),
    customer('fabrikam', 'Fabrikam', 'Silver', 'it@fabrikam.example'),
    customer('northwind', 'Northwind', 'Standard', 'ops@northwind.example', true),
    customer('tailspin', 'Tailspin', 'Gold', 'cert@tailspin.example'),
    customer('adatum', 'Adatum', 'Standard', 'admin@adatum.example'),
    customer('litware', 'Litware', 'Silver', 'it@litware.example'),
    customer('wingtip', 'Wingtip', 'Gold', 'soc@wingtip.example'),
    customer('woodgrove', 'Woodgrove', 'Standard', 'ops@woodgrove.example', true),
  ];
  const all = { dev: true, staging: true, prod: true };
  const dep = (name: string, version: string, via = '', env: Record<string, string> = {}): Dep =>
    ({ name, version, direct: !via, via, env });
  const repo = (
    id: string, name: string, eco: Repo['ecosystem'], tests: Repo['tests'], deployed: Record<string, boolean>,
    releases: Record<string, string>, deps: Dep[], watched = true,
  ): Repo => ({ id, name, ecosystem: eco, watched, source: 'seed', tests, deployed, releases, deps });
  const project = (id: string, name: string, owner: string, ec: Record<string, string[]>, repos: Repo[]): Project => ({
    id, name, owner, repos,
    envs: Object.fromEntries(Object.entries(ec).map(([envId, ids]) => [envId, { customers: ids }])),
  });

  return {
    envs,
    customers,
    projects: [
      project('shop', 'Shop', 'Team Checkout', { staging: ['contoso'], prod: ['contoso', 'fabrikam', 'northwind'] }, [
        repo('checkout-web', 'checkout-web', 'npm', 'good', all, { dev: 'main@a1f9c2', staging: 'v3.8.0', prod: 'v3.7.2' }, [
          dep('express', '4.18.2'), dep('qs', '6.11.0', 'express'), dep('lodash', '4.17.21', '', { prod: '4.17.15' }),
          dep('axios', '1.6.0', '', { prod: '0.21.1', staging: '0.21.1' }), dep('follow-redirects', '1.15.6', 'axios', { prod: '1.14.7', staging: '1.14.7' }),
          dep('jsonwebtoken', '8.5.1'), dep('react', '18.2.0'),
        ]),
        repo('checkout-api', 'checkout-api', 'npm', 'some', all, { dev: 'main@5d21aa', staging: 'v2.3.0', prod: 'v2.2.4' }, [
          dep('express', '4.19.2'), dep('jsonwebtoken', '9.0.2', '', { prod: '8.5.1' }), dep('semver', '7.5.4', 'jsonwebtoken', { prod: '7.3.5' }), dep('ws', '8.17.1'),
        ]),
      ]),
      project('payments', 'Payments', 'Team Payments', { staging: ['woodgrove'], prod: ['contoso', 'tailspin'] }, [
        repo('payments-api', 'payments-api', 'PyPI', 'good', all, { dev: 'main@7c03be', staging: 'v2.14.1', prod: 'v2.14.1' }, [
          dep('django', '4.2.11', '', { prod: '3.2.4', staging: '3.2.4' }), dep('requests', '2.25.1'), dep('urllib3', '1.26.4', 'requests'),
          dep('certifi', '2021.5.30', 'requests'), dep('cryptography', '42.0.5'), dep('pyyaml', '6.0.1'),
        ]),
        repo('payments-worker', 'payments-worker', 'PyPI', 'some', all, { dev: 'main@c18f07', staging: 'v1.6.0', prod: 'v1.5.2' }, [
          dep('celery', '5.3.6'), dep('requests', '2.31.0'), dep('urllib3', '1.26.18', 'requests', { prod: '1.26.4' }), dep('pyyaml', '5.3.1'),
        ]),
      ]),
      project('edge', 'Edge', 'Team Platform', { staging: ['fabrikam'] }, [
        repo('edge-proxy', 'edge-proxy', 'Go', 'good', { dev: true, staging: true, prod: false }, { dev: 'main@e44d10', staging: 'v0.9.0-rc2', prod: '' }, [
          dep('github.com/gin-gonic/gin', 'v1.7.2'), dep('golang.org/x/net', 'v0.17.0', 'github.com/gin-gonic/gin', { staging: 'v0.7.0' }),
          dep('gopkg.in/yaml.v3', 'v3.0.1', 'github.com/gin-gonic/gin'), dep('google.golang.org/grpc', 'v1.58.3'), dep('github.com/golang-jwt/jwt/v4', 'v4.5.0'),
        ]),
      ]),
      project('partner-portal', 'Partner portal', 'Team Partners', { staging: ['adatum'], prod: ['adatum', 'litware', 'wingtip'] }, [
        repo('partner-portal-web', 'partner-portal-web', 'npm', 'none', all, { dev: 'main@91c0de', staging: 'v1.12.0', prod: 'v1.11.3' }, [
          dep('next', '13.4.0'), dep('react', '18.2.0'), dep('lodash', '4.17.15'), dep('jsonwebtoken', '8.5.1'), dep('moment', '2.29.1'),
        ]),
        repo('partner-auth', 'partner-auth', 'npm', 'good', all, { dev: 'main@3b77e2', staging: 'v0.8.1', prod: 'v0.8.0' }, [
          dep('express', '4.18.2'), dep('express-jwt', '7.7.5'), dep('jsonwebtoken', '8.5.1', 'express-jwt'), dep('qs', '6.11.0', 'express'),
        ]),
      ]),
      project('marketing', 'Marketing', 'Team Web', { prod: ['northwind'] }, [
        repo('marketing-site', 'marketing-site', 'npm', 'some', { dev: true, staging: false, prod: true }, { dev: 'main@0b2e91', staging: '', prod: 'v1.4.0' }, [
          dep('next', '14.2.10'), dep('react', '18.3.1'), dep('lodash', '4.17.21'), dep('axios', '1.7.4'),
        ], false),
      ]),
    ],
  };
}
