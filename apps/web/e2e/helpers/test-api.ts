import type { EkzaAnimatorTestApi } from '@ekza-studio/editor';
import { expect, type Page } from '@playwright/test';

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

// ---------- integration gates (MVP-SPEC §8.1, §8.2) ----------
// During the parallel build these gates marked a spec fixme while a piece had not landed (a stub answering EkzaError
// 'not-implemented', an operator not registered yet, a placeholder panel). Every work package has landed (WP-10), so
// each of them now fails the test with the piece and its owner: a regression can never turn into a skipped scenario.
// Unbuilt M1-stretch items are `test.fixme` with a reason in `stretch.spec.ts` instead (MVP-SPEC §1.2).

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

/** Fails when an operator result shows an unregistered operator or a stub ('not-implemented'). */
export function failIfBlocked(what: string, result: RunResult): void {
  if (result.status === 'cancelled' && (result.reason ?? '').startsWith('unknown operator')) {
    throw new Error(`${what} is not registered (owner ${operatorOwner(what)}): ${result.reason ?? ''}`);
  }
  if (result.status === 'failed' && result.error?.code === 'not-implemented') {
    throw new Error(`${what} reached an unimplemented stub: ${result.error.message}`);
  }
}

/** Fails while the panel of `kind` is the shell's placeholder (its panel is not registered). */
export async function expectPanelRegistered(page: Page, kind: string): Promise<void> {
  await expect(
    page.getByTestId(`placeholder-${kind}`),
    `the ${kind} panel is registered (owner ${PANEL_OWNERS[kind] ?? 'unknown'})`,
  ).toHaveCount(0);
}

/** Fails when /editor shows "The editor could not start" instead of the editor. */
export async function expectKernelStarted(page: Page): Promise<void> {
  if ((await page.getByTestId('kernel-unavailable').count()) > 0) {
    const reason = (await page.getByTestId('kernel-unavailable-message').textContent()) ?? '';
    throw new Error(`The editor kernel did not start: ${reason.trim()}`);
  }
}

/**
 * A failure the shell reported for a UI action ends a wait: an error toast or an "unknown operator" in the help line
 * (a button whose operator is not registered) fails the test with its text.
 */
export async function failOnReportedError(page: Page): Promise<void> {
  const help = ((await page.getByTestId('helpline-text').textContent()) ?? '').trim();
  const unknown = /unknown operator '([^']+)'/.exec(help);
  if (unknown !== null) {
    throw new Error(`${unknown[1] ?? ''} is not registered (owner ${operatorOwner(unknown[1] ?? '')}): ${help}`);
  }
  const toast = page.locator('[data-testid="toast"][data-kind="error"]').first();
  if ((await toast.count()) === 0) return;
  throw new Error(`Error toast: ${((await toast.textContent()) ?? '').trim()}`);
}

/**
 * Registration check for UI buttons that run an operator without the shell (e.g. the viewport's sample buttons call
 * `app.run`, so an unregistered operator leaves no trace): runs `op` with arguments it must refuse (`invalidArgs`).
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

/** Calls a read function of the test API; a throwing function fails the test with its message. */
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
  if (isFailure(value)) throw new Error(`${name}() failed: ${value.__failure.message}`);
  return value as ReturnType<TestApi[K]>;
}

/** `run()` through the test API; unregistered operators and stubs fail the test (see above). */
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
  failIfBlocked(op, result);
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

/** `loadFile()` with bytes from Node (sent base64-encoded); a failed load fails the test with its message. */
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
