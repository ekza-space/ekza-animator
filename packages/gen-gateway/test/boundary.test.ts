// The client-bundle check (tooling/check-gen-boundary.mjs) reads its list from tooling/gen-boundary.json: every
// adapter's key and secret variables and every host it talks to must be on that list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAdapters, GATEWAY_MARKER, hostAllowed } from '../src/index.ts';

const boundary = JSON.parse(readFileSync(join(__dirname, '../../../tooling/gen-boundary.json'), 'utf8')) as {
  keyNames: string[];
  hosts: string[];
  markers: string[];
};

describe('client-bundle boundary list', () => {
  it('covers every adapter key variable, API host and download host, and the gateway marker', () => {
    const adapters = defaultAdapters();
    const keys = adapters.flatMap((a) => [a.keyEnv, ...(a.webhookSecretEnv === null ? [] : [a.webhookSecretEnv])]);
    const apiHosts = adapters.map((a) => new URL(a.apiBase).hostname);
    const downloadHosts = adapters.flatMap((a) => a.downloadHosts.map((d) => d.replace(/^\./, '')));
    const termsHosts = adapters.map((a) => new URL(a.terms.termsUrl).hostname);
    const covered = (host: string): boolean => boundary.hosts.some((h) => hostAllowed(host, [h, `.${h}`]));
    expect(boundary.markers).toContain(GATEWAY_MARKER);
    expect(boundary.keyNames).toContain('GEN_GATEWAY_TOKEN');
    expect(keys.filter((k) => !boundary.keyNames.includes(k))).toEqual([]);
    expect([...apiHosts, ...downloadHosts, ...termsHosts].filter((h) => !covered(h))).toEqual([]);
  });
});
