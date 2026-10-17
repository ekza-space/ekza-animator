import type { EkzaAnimatorTestApi } from '@ekza-animator/editor';
import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __EKZA_ANIMATOR_TEST__?: EkzaAnimatorTestApi;
  }
}

export type TestApi = EkzaAnimatorTestApi;
export type RunResult = Awaited<ReturnType<TestApi['run']>>;

/** Opens the editor in e2e mode and waits for `__EKZA_ANIMATOR_TEST__.ready` (MVP-SPEC §6.1). */
export async function openEditor(page: Page, query = ''): Promise<void> {
  await page.goto(`/editor?e2e=1${query}`);
  await waitForTestApi(page);
}

/** Waits for the test API of the current page (after a navigation or a reload). */
export async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__EKZA_ANIMATOR_TEST__ !== undefined);
  await page.evaluate(async () => {
    await window.__EKZA_ANIMATOR_TEST__?.ready;
  });
}

export function renderedFrames(page: Page): Promise<number> {
  return page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.renderedFrames() ?? Number.NaN);
}

// ---------- pre-integration gating (MVP-SPEC §8.1) ----------
// Until every work package is merged, parts of the editor are stubs (EkzaError 'not-implemented'), operators are not
// registered yet (the runner answers "unknown operator '<id>'") and panels are placeholders. A spec that reaches one
// of them is marked fixme with the blocking work package instead of failing; it runs unchanged once the piece lands.

const OPERATOR_OWNERS: readonly (readonly [RegExp, string])[] = [
  [/^view\.(layout|frame|display\.toggle|lookThrough|copyViewToShot|toggleCameraLock|cameraRadial)$/, 'WP-5'],
  [/^(graph\.frame|select\.curveKeys)$/, 'WP-6'],
  [/^time\.selectBand$/, 'WP-6t'],
  [/^(view\.toggleMaximize|ui\.open|ui\.close)$/, 'WP-8'],
];

/** The work package that registers an operator (MVP-SPEC §4.9 owner column). */
export function operatorOwner(op: string): string {
  return OPERATOR_OWNERS.find(([pattern]) => pattern.test(op))?.[1] ?? 'WP-7b';
}

const PANEL_OWNERS: Readonly<Record<string, string>> = {
  viewport: 'WP-5',
  graph: 'WP-6',
  timeline: 'WP-6t',
  outliner: 'WP-9',
  clips: 'WP-9',
  channelBox: 'WP-9',
  attributes: 'WP-9',
};

/** Marks the running test fixme when an operator result shows a piece that has not landed. */
export function fixmeIfBlocked(what: string, result: RunResult): void {
  if (result.status === 'cancelled' && (result.reason ?? '').startsWith('unknown operator')) {
    test.fixme(true, `Blocked by ${operatorOwner(what)}: ${result.reason ?? ''}`);
  }
  if (result.status === 'failed' && result.error?.code === 'not-implemented') {
    test.fixme(true, `Blocked by an unimplemented stub (${result.error.message}) in ${what}`);
  }
}

/** Marks the running test fixme while the panel of `kind` is still the shell's placeholder. */
export async function fixmeIfPlaceholder(page: Page, kind: string): Promise<void> {
  if ((await page.getByTestId(`placeholder-${kind}`).count()) > 0) {
    test.fixme(true, `Blocked by ${PANEL_OWNERS[kind] ?? 'its owner'}: the ${kind} panel is not registered yet`);
  }
}

/** Marks the running test fixme while /editor shows "The editor could not start" (a stubbed kernel). */
export async function fixmeIfKernelUnavailable(page: Page): Promise<void> {
  if ((await page.getByTestId('kernel-unavailable').count()) > 0) {
    const reason = (await page.getByTestId('kernel-unavailable-message').textContent()) ?? '';
    test.fixme(true, `Blocked by WP-7a: the editor kernel did not start (${reason.trim()})`);
  }
}

/**
 * A failure the shell reported for a UI action ends a wait: an error toast fails the test with its text, unless a stub
 * caused it ("not implemented in this build": fixme); an "unknown operator" in the help line is a fixme naming the
 * operator's owner (a button whose operator has not landed).
 */
export async function failOnReportedError(page: Page): Promise<void> {
  const help = ((await page.getByTestId('helpline-text').textContent()) ?? '').trim();
  const unknown = /unknown operator '([^']+)'/.exec(help);
  if (unknown !== null) test.fixme(true, `Blocked by ${operatorOwner(unknown[1] ?? '')}: ${help}`);
  const toast = page.locator('[data-testid="toast"][data-kind="error"]').first();
  if ((await toast.count()) === 0) return;
  const text = ((await toast.textContent()) ?? '').trim();
  test.fixme(text.includes('not implemented in this build'), `Blocked by an unimplemented stub: ${text}`);
  throw new Error(`Error toast: ${text}`);
}

/**
 * Gate for UI buttons that run an operator without the shell (e.g. the viewport's sample buttons call `app.run`, so
 * an unregistered operator leaves no trace): runs `op` with arguments it must refuse (`invalidArgs`), which only
 * tells whether it is registered (fixme when not). Remove once every work package has landed (WP-10).
 */
export async function requireOperator(page: Page, op: string, invalidArgs: unknown): Promise<void> {
  const result = await run(page, op, invalidArgs);
  expect(result.status, `${op} must refuse the probe arguments`).not.toBe('finished');
}

/** Polls `counts()[table]` until it equals `count`; a reported failure ends the wait (see failOnReportedError). */
export async function waitForCount(page: Page, table: string, count: number, timeout = 30_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await failOnReportedError(page);
        return (await call(page, 'counts'))[table];
      },
      { timeout },
    )
    .toBe(count);
}

// ---------- calls into the page ----------

type Failure = { readonly __failure: { readonly code: string | null; readonly message: string } };
const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && '__failure' in value;

/** Calls a read function of the test API; a stub ('not-implemented') marks the test fixme. */
export async function call<K extends Exclude<keyof TestApi, 'ready' | 'webgl' | 'run' | 'loadFile'>>(
  page: Page,
  name: K,
  ...args: Parameters<TestApi[K]>
): Promise<ReturnType<TestApi[K]>> {
  const value: unknown = await page.evaluate(
    ([fn, fnArgs]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) return { __failure: { code: null, message: 'no test API on this page' } };
      try {
        return (api[fn] as (...a: unknown[]) => unknown)(...fnArgs);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return {
          __failure: {
            code: typeof code === 'string' ? code : null,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    [name, args] as const,
  );
  if (isFailure(value)) {
    if (value.__failure.code === 'not-implemented') {
      test.fixme(true, `Blocked by an unimplemented stub (${value.__failure.message}) in ${name}()`);
    }
    throw new Error(`${name}() failed: ${value.__failure.message}`);
  }
  return value as ReturnType<TestApi[K]>;
}

/** `run()` through the test API; missing operators and stubs mark the test fixme (see above). */
export async function run(page: Page, op: string, args?: unknown, ctx?: { panel?: string; paneId?: string }) {
  const result: RunResult = await page.evaluate(
    async ([id, runArgs, runCtx]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) return { status: 'failed', error: { code: 'internal', message: 'no test API' } };
      try {
        return await api.run(id, runArgs, runCtx ?? undefined);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return {
          status: 'failed',
          error: {
            code: typeof code === 'string' ? code : 'internal',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
    [op, args, ctx ?? null] as const,
  );
  fixmeIfBlocked(op, result);
  return result;
}

/** `run()` that must finish; returns the operator's value. */
export async function runOk<T = unknown>(
  page: Page,
  op: string,
  args?: unknown,
  ctx?: { panel?: string; paneId?: string },
): Promise<T> {
  const result = await run(page, op, args, ctx);
  expect(result.status, `${op}: ${result.reason ?? result.error?.message ?? ''}`).toBe('finished');
  return result.value as T;
}

/** `loadFile()` with bytes from Node (sent base64-encoded); stubs and missing importers mark the test fixme. */
export async function loadFile(
  page: Page,
  name: string,
  bytes: Uint8Array,
  opts?: { auto?: boolean; importOptions?: Record<string, unknown> },
): Promise<void> {
  const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  const error = await page.evaluate(
    async ([fileName, data, options]) => {
      const binary = atob(data);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      try {
        await window.__EKZA_ANIMATOR_TEST__?.loadFile(fileName, array, options ?? undefined);
        return null;
      } catch (failure) {
        const code = (failure as { code?: unknown }).code;
        return {
          code: typeof code === 'string' ? code : null,
          message: failure instanceof Error ? failure.message : String(failure),
        };
      }
    },
    [name, base64, opts ?? null] as const,
  );
  if (error === null) return;
  if (error.code === 'not-implemented' || error.message.startsWith('No importer for')) {
    test.fixme(true, `Blocked (loading ${name}): ${error.message}`);
  }
  if (error.message.startsWith('unknown operator')) test.fixme(true, `Blocked by WP-7b: ${error.message}`);
  throw new Error(`loadFile('${name}') failed: ${error.message}`);
}

/** The last exported or saved file (`lastExport()`), with its bytes copied to Node. */
export async function lastExport(page: Page): Promise<{ fileName: string; sha256: string; bytes: Buffer } | null> {
  const last = await page.evaluate(() => {
    const value = window.__EKZA_ANIMATOR_TEST__?.lastExport() ?? null;
    if (value === null) return null;
    let binary = '';
    for (let i = 0; i < value.bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...value.bytes.subarray(i, i + 0x8000));
    }
    return { fileName: value.fileName, sha256: value.sha256, base64: btoa(binary) };
  });
  return last === null
    ? null
    : { fileName: last.fileName, sha256: last.sha256, bytes: Buffer.from(last.base64, 'base64') };
}
