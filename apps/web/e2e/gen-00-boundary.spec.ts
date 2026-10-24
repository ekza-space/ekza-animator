import { expect, type Page, test } from '@playwright/test';
import { openAutoRigReady } from './helpers/ar-host';
import { openHalo } from './helpers/halo';
import { seedSample } from './helpers/seed';
import { openEditor } from './helpers/test-api';

// M7 G-b (ADR 0017 §1–§2, MODELING-PLAN §3.11): the app's first Content-Security-Policy and the default-deny gateway
// route. The e2e server runs without GEN_GATEWAY_ENABLED, as every deployment does by default.

const PROVIDER_HOSTS = ['tripo3d', 'meshy.ai', 'hyper3d', 'tencentcloudapi', 'fal.run', 'fal.ai', 'stability.ai'];

declare global {
  interface Window {
    __cspViolations?: { directive: string; blocked: string }[];
  }
}

async function collectViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push({ directive: e.effectiveDirective, blocked: e.blockedURI });
    });
  });
}

test('the generation gateway route is a 404 unless the operator enables it', async ({ request }) => {
  for (const [method, path] of [
    ['GET', '/api/gen/v1/providers'],
    ['POST', '/api/gen/v1/jobs'],
    ['POST', '/api/gen/v1/uploads'],
    ['POST', '/api/gen/v1/hooks/tripo'],
    ['GET', '/api/gen/v1/artifacts/0000000000000000000000000000000000000000000000000000000000000000'],
  ] as const) {
    const res = await request.fetch(path, { method, data: method === 'POST' ? '{}' : undefined });
    expect(res.status(), `${method} ${path}`).toBe(404);
  }
});

test('every route sends the CSP: self, the agent bridge on loopback, no provider origin, no eval', async ({
  request,
}) => {
  for (const path of ['/', '/editor', '/autorig', '/app']) {
    const res = await request.get(path);
    expect(res.ok(), path).toBe(true);
    const csp = res.headers()['content-security-policy'] ?? '';
    const directives = new Map(
      csp.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name ?? '', values] as const;
      }),
    );
    expect(directives.get('default-src'), path).toEqual(["'self'"]);
    expect(directives.get('object-src'), path).toEqual(["'none'"]);
    expect(directives.get('base-uri'), path).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors'), path).toEqual(["'self'"]);
    expect(directives.get('script-src'), path).not.toContain("'unsafe-eval'");
    expect(directives.get('script-src'), path).toContain("'wasm-unsafe-eval'");
    expect(directives.get('worker-src'), path).toEqual(["'self'", 'blob:']);
    const connect = directives.get('connect-src') ?? [];
    expect(connect, path).toEqual(expect.arrayContaining(["'self'", 'ws://127.0.0.1:*']));
    for (const host of PROVIDER_HOSTS) expect(csp, `${path}: ${host}`).not.toContain(host);
  }
});

test('the editor boots, loads a model and runs the kernel under the CSP without a violation', async ({ page }) => {
  await collectViolations(page);
  await openEditor(page);
  // A sample through the model loader (Draco/KTX2/meshopt workers and WebAssembly where the file needs them).
  await seedSample(page, 'polybot');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('Auto-Rig and the touch shell boot under the CSP without a violation', async ({ page }) => {
  await collectViolations(page);
  await openAutoRigReady(page);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  await openHalo(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test('a page cannot reach a provider (or any other) origin directly: the CSP blocks it', async ({ page }) => {
  await collectViolations(page);
  await openEditor(page);
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://api.meshy.ai/openapi/v1/image-to-3d', { method: 'POST', body: '{}' });
      return 'sent';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  expect(violations).toEqual([expect.objectContaining({ directive: 'connect-src' })]);
  expect(violations[0]?.blocked).toContain('api.meshy.ai');
});
