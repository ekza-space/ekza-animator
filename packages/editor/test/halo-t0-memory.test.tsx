// Halo T0 memory profile (STUDIO-TOUCH-SPEC S8, §16.4; ST-20): the decision per device (DPR cap above 4 MP, MSAA off
// above 5 MP, the texture cap, the 96 + 24 MB budgets, the triangle limits), the `device` preference override applied
// once per page and never stored, and the GL host creating its context from the profile.
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decideMemoryProfile,
  IOS_MEMORY,
  memoryProfileOf,
  readDeviceFacts,
  STANDARD_PROFILE,
} from '../src/host/memoryProfile';
import { createMemoryStorage } from '../src/services/storage';
import { EditorRoot } from '../src/shell/EditorRoot';
import { DEFAULT_PARAMS } from '../src/test-api/params';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { liveEnvironment, mountLive, waitFor } from './shell-helpers';

const PREFS_KEY = 'ekza-animator.prefs';

/** CSS pixels of an iPad screen in points (landscape or portrait: the area is the same). */
const IPAD_11_M4 = 1210 * 834; // 2420 × 1668 px = 4.04 MP
const IPAD_13 = 1376 * 1032; // 2752 × 2064 px = 5.68 MP
const IPAD_AIR_11 = 1180 * 820; // 3.87 MP

describe('decideMemoryProfile', () => {
  it('keeps today’s settings off iOS', () => {
    expect(decideMemoryProfile({ ios: false, dpr: 2, cssPixels: IPAD_13 })).toBe(STANDARD_PROFILE);
    expect(STANDARD_PROFILE).toEqual({
      id: 'standard',
      dpr: [1, 2],
      antialias: true,
      textureCapPx: null,
      prefs: null,
      triangles: null,
    });
  });

  it('caps the DPR above 4 MP and turns MSAA off above 5 MP, at the native ratio', () => {
    const air = decideMemoryProfile({ ios: true, dpr: 2, cssPixels: IPAD_AIR_11 });
    expect([air.dpr, air.antialias]).toEqual([[1, 2], true]);
    const pro11 = decideMemoryProfile({ ios: true, dpr: 2, cssPixels: IPAD_11_M4 });
    expect([pro11.dpr, pro11.antialias]).toEqual([[1, 1.5], true]);
    const pro13 = decideMemoryProfile({ ios: true, dpr: 2, cssPixels: IPAD_13 });
    expect([pro13.dpr, pro13.antialias]).toEqual([[1, 1.5], false]);
    const phone = decideMemoryProfile({ ios: true, dpr: 3, cssPixels: 393 * 852 }); // 3.01 MP
    expect([phone.dpr, phone.antialias]).toEqual([[1, 2], true]);
  });

  it('caps textures at 2048, lowers the budgets to 96 + 24 MB and carries Auto-Rig’s triangle gate', () => {
    const profile = decideMemoryProfile({ ios: true, dpr: 2, cssPixels: IPAD_AIR_11 });
    expect(profile.id).toBe('ios');
    expect(profile.textureCapPx).toBe(2048);
    expect(profile.prefs).toEqual({ modeling: { undoBudgetMB: 96, journalBudgetMB: 24 } });
    expect(profile.triangles).toEqual({ warn: 60_000, limit: 200_000 });
    expect(IOS_MEMORY.undoBudgetMB + IOS_MEMORY.journalBudgetMB).toBe(120);
  });

  it('reads the device from the window: an iPad user agent with touch points, the larger of screen and window', () => {
    const facts = readDeviceFacts({
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari',
        maxTouchPoints: 5,
      },
      devicePixelRatio: 2,
      screen: { width: 834, height: 1194 },
      innerWidth: 1194,
      innerHeight: 834,
    } as unknown as Window);
    expect(facts).toEqual({ ios: true, dpr: 2, cssPixels: 834 * 1194 });
  });
});

describe('memoryProfileOf (the page applies it once)', () => {
  const urls: string[] = [];
  afterEach(() => {
    const url = urls.pop();
    if (url !== undefined) history.replaceState(history.state, '', url);
  });
  const withSearch = (search: string): void => {
    urls.push(location.href);
    history.replaceState(history.state, '', `${location.pathname}${search}`);
  };

  it('lays the iOS budgets over the preferences in the device layer, never in storage', () => {
    withSearch('?e2e=1&memoryProfile=ios');
    const storage = createMemoryStorage();
    const app = createFakeEditorApp({ services: { storage } });
    const profile = memoryProfileOf({ app, params: { e2e: true } });
    expect(profile.id).toBe('ios');
    expect(memoryProfileOf({ app, params: { e2e: true } })).toBe(profile);
    expect(app.prefs.getState().modeling).toMatchObject({ undoBudgetMB: 96, journalBudgetMB: 24 });
    app.prefs.setState({ uiScale: 1.25 });
    const stored = JSON.parse(storage.getItem(PREFS_KEY) ?? '{}') as { modeling: { undoBudgetMB: number } };
    expect(stored.modeling.undoBudgetMB).toBe(256);
    app.dispose();
  });

  it('honours the switch only in e2e mode; standard changes nothing', () => {
    withSearch('?memoryProfile=ios');
    const app = createFakeEditorApp();
    expect(memoryProfileOf({ app, params: { e2e: false } }).id).toBe('standard'); // the test browser is desktop
    expect(app.prefs.getState().modeling.undoBudgetMB).toBe(256);
    app.dispose();
  });
});

describe('the GL host under the iOS profile', () => {
  let restoreAct: () => void = () => {};
  let style: HTMLStyleElement;
  const url = location.href;
  beforeAll(() => {
    restoreAct = liveEnvironment();
    style = document.createElement('style');
    style.textContent =
      '.ekza-editor{position:relative;width:1440px;height:900px;display:block}' +
      '[data-testid="gl-host"]{position:fixed;inset:0;pointer-events:none}';
    document.head.append(style);
  });
  afterAll(() => {
    style.remove();
    restoreAct();
    history.replaceState(history.state, '', url);
  });

  it('creates its context from the profile and names it', async () => {
    history.replaceState(history.state, '', `${location.pathname}?e2e=1&memoryProfile=ios`);
    let app: FakeEditorApp | null = null;
    const view = mountLive(
      <EditorRoot
        params={{ ...DEFAULT_PARAMS, e2e: true }}
        createApp={({ services, platform }) => {
          app = createFakeEditorApp({ services: { ...services, models: createSyntheticModelLoader() }, platform });
          return app;
        }}
      />,
    );
    await waitFor(() => document.querySelector('[data-testid="gl-host"] canvas') !== null, 5000);
    const host = document.querySelector<HTMLElement>('[data-testid="gl-host"]');
    expect(host?.dataset['memoryProfile']).toBe('ios');
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="gl-host"] canvas');
    const context = canvas?.getContext('webgl2');
    // this desktop's screen is far below 5 MP at its native ratio: MSAA stays on
    expect(context?.getContextAttributes()?.antialias).toBe(true);
    expect((app as FakeEditorApp | null)?.prefs.getState().modeling.undoBudgetMB).toBe(96);
    await view.unmount();
  });
});
