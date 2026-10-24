// T11's e2e helpers (STUDIO-TOUCH-SPEC §13.3, §17, §9 J9–J10, §20.7): Halo's `t11` slice of the test API, a tap that
// is a touch on the touch projects and a click on `chrome`, the mocked Web Share of WebKit (macOS WebKit cannot show
// the iPad's share sheet: the two-step save is checked with a mock here and on a device, D11), and Share's state.
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { halo } from './halo';

export interface T11Slice {
  readonly continue: readonly string[];
  readonly resume: { readonly slot: string; readonly frame: number | null } | null;
  readonly restoring: boolean;
  readonly storage: 'hidden' | 'keep' | 'homeScreen';
  readonly share: {
    readonly status: 'idle' | 'preparing' | 'ready' | 'blocked' | 'failed';
    readonly fileName: string | null;
    readonly bytes: number;
    readonly delivered: 'shared' | 'downloaded' | null;
    readonly reason: string | null;
    readonly lints: readonly string[];
  } | null;
}

export async function t11(page: Page): Promise<T11Slice> {
  return (await halo(page)).slices['t11'] as T11Slice;
}

export const isTouch = (info: TestInfo): boolean => info.project.name !== 'chrome';
export const isWebkit = (info: TestInfo): boolean => info.project.name === 'webkit-ipad';

/** A tap on the touch projects (a real touch through the browser), a click with the mouse on `chrome`. */
export async function press(page: Page, testId: string, info: TestInfo): Promise<void> {
  const target = page.getByTestId(testId);
  await expect(target).toBeVisible();
  if (isTouch(info)) await target.tap();
  else await target.click();
}

/** The journeys' touch counter (`halo().touches`). */
export async function touches(page: Page): Promise<number> {
  return (await halo(page)).touches;
}

/** Web Share mocked for WebKit (as ha-00 does): `canShare` takes files, `share` records them and resolves. */
export async function mockShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: { name: string; size: number; type: string }[] = [];
    (window as unknown as { __haShared: typeof shared }).__haShared = shared;
    Object.defineProperty(Navigator.prototype, 'canShare', {
      configurable: true,
      value: (data?: { files?: File[] }) => (data?.files ?? []).length > 0,
    });
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: (data?: { files?: File[] }) => {
        for (const file of data?.files ?? []) shared.push({ name: file.name, size: file.size, type: file.type });
        return Promise.resolve();
      },
    });
  });
}

export async function sharedFiles(page: Page): Promise<{ name: string; size: number }[]> {
  return page.evaluate(() => (window as unknown as { __haShared?: { name: string; size: number }[] }).__haShared ?? []);
}

/** Waits until Share's prepared file is ready (or blocked / failed: the test reads why). */
export async function shareSettled(page: Page): Promise<NonNullable<T11Slice['share']>> {
  await expect
    .poll(async () => (await t11(page)).share?.status ?? 'idle', { timeout: 60_000 })
    .toMatch(/^(ready|blocked|failed)$/);
  return (await t11(page)).share as NonNullable<T11Slice['share']>;
}

/** The unsaved dot of `◂ Project • ▾` (its accessible name says "unsaved changes"). */
export async function unsavedDot(page: Page): Promise<boolean> {
  const label = (await page.getByTestId('halo-project').getAttribute('aria-label')) ?? '';
  return label.includes('unsaved changes');
}
