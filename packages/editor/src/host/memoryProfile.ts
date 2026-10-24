// The per-device memory profile (STUDIO-TOUCH-SPEC S8, §16.4, §20.3 item 15; ST-20): iPad Safari kills a tab at
// roughly 1.5–2 GB, so on iOS WebKit the host spends less of it — on every route and in every shell, because the
// limit belongs to the device. It is decided once per page, before the GL host creates its context (MSAA cannot be
// switched later), and it never changes the document or what an export writes:
//
// - the canvas's device pixel ratio is capped at 1.5 when the screen has more than 4 MP at its native ratio;
// - MSAA is off when the screen has more than 5 MP at its native ratio;
// - textures above 2048² are drawn smaller at GPU upload only (`@ekza-studio/viewport` `applyTextureCap`);
// - the undo history and the mesh journal budgets drop from 256 + 64 MB to 96 + 24 MB, through the `device` layer of
//   the effective preferences (the stored preferences keep the user's values; `overridePrefs`);
// - heavy models: a warning from 60k triangles, a refusal above 200k (Auto-Rig's gate, for intake surfaces to read).
//
// Everywhere else the profile is `standard`: today's DPR range [1, 2], MSAA on, no cap, no override. e2e builds can
// force either with `?memoryProfile=ios|standard` (with `?e2e=1`), so the same browser runs both.
import { type EditorApp, overridePrefs, type PrefsPatch } from '@ekza-studio/editor-core';
import { TEXTURE_CAP_PX } from '@ekza-studio/viewport';
import { isIosWebKit } from '../services/fileTypes';

export type MemoryProfileId = 'standard' | 'ios';

export interface MemoryProfile {
  readonly id: MemoryProfileId;
  /** The canvas's device pixel ratio range (R3F `dpr`): the window's ratio clamped into it. */
  readonly dpr: readonly [number, number];
  /** MSAA on the WebGL context (fixed when the context is created). */
  readonly antialias: boolean;
  /** Larger textures are drawn at this size per side at GPU upload; null: no cap. */
  readonly textureCapPx: number | null;
  /** Laid over the preferences in the `device` layer for the page's life; null: none. */
  readonly prefs: PrefsPatch | null;
  /** Triangle counts of a model at intake: a warning above `warn`, a refusal above `limit`; null: no device limit. */
  readonly triangles: { readonly warn: number; readonly limit: number } | null;
}

/** The iOS profile's numbers (ST-20; tuned on devices, D7 and D8). */
export const IOS_MEMORY = {
  dprCap: 1.5,
  dprCapAboveMp: 4,
  msaaOffAboveMp: 5,
  textureCapPx: TEXTURE_CAP_PX,
  undoBudgetMB: 96,
  journalBudgetMB: 24,
  warnTriangles: 60_000,
  maxTriangles: 200_000,
} as const;

/** Today's canvas DPR range (GLHost before the profile). */
const STANDARD_DPR: readonly [number, number] = [1, 2];

export const STANDARD_PROFILE: MemoryProfile = {
  id: 'standard',
  dpr: STANDARD_DPR,
  antialias: true,
  textureCapPx: null,
  prefs: null,
  triangles: null,
};

/** What the decision reads of the device. */
export interface DeviceFacts {
  readonly ios: boolean;
  /** `devicePixelRatio`. */
  readonly dpr: number;
  /** The largest area the canvas can cover, in CSS pixels (the screen, or the window when it reports more). */
  readonly cssPixels: number;
}

/** The profile of a device (pure; `readDeviceFacts` reads the browser's). */
export function decideMemoryProfile(device: DeviceFacts): MemoryProfile {
  if (!device.ios) return STANDARD_PROFILE;
  const dpr = Number.isFinite(device.dpr) && device.dpr > 0 ? device.dpr : 1;
  const nativeMp = (device.cssPixels * dpr * dpr) / 1_000_000;
  const maxDpr = nativeMp > IOS_MEMORY.dprCapAboveMp ? Math.min(STANDARD_DPR[1], IOS_MEMORY.dprCap) : STANDARD_DPR[1];
  return {
    id: 'ios',
    dpr: [1, maxDpr],
    antialias: nativeMp <= IOS_MEMORY.msaaOffAboveMp,
    textureCapPx: IOS_MEMORY.textureCapPx,
    prefs: { modeling: { undoBudgetMB: IOS_MEMORY.undoBudgetMB, journalBudgetMB: IOS_MEMORY.journalBudgetMB } },
    triangles: { warn: IOS_MEMORY.warnTriangles, limit: IOS_MEMORY.maxTriangles },
  };
}

/** The browser's device facts. */
export function readDeviceFacts(win: Window = window): DeviceFacts {
  const screen = win.screen as Screen | undefined;
  const screenPixels = screen === undefined ? 0 : screen.width * screen.height;
  return {
    ios: isIosWebKit(win.navigator),
    dpr: win.devicePixelRatio,
    cssPixels: Math.max(screenPixels, win.innerWidth * win.innerHeight),
  };
}

/** The e2e switch `?memoryProfile=ios|standard` (honoured only with `?e2e=1`). */
function forcedProfile(e2e: boolean, search: string): MemoryProfileId | null {
  if (!e2e) return null;
  const value = new URLSearchParams(search).get('memoryProfile');
  return value === 'ios' || value === 'standard' ? value : null;
}

const decided = new WeakMap<EditorApp, MemoryProfile>();

/**
 * The page's memory profile: decided at the first call (the GL host's first render, before its context exists) and
 * applied once — its preference patch goes into the `device` layer for the app's life. Later calls return it.
 */
export function memoryProfileOf(host: {
  readonly app: EditorApp;
  readonly params: { readonly e2e: boolean };
}): MemoryProfile {
  const known = decided.get(host.app);
  if (known !== undefined) return known;
  const facts = readDeviceFacts();
  const forced = forcedProfile(host.params.e2e, window.location.search);
  const profile = decideMemoryProfile(forced === null ? facts : { ...facts, ios: forced === 'ios' });
  decided.set(host.app, profile);
  if (profile.prefs !== null) overridePrefs(host.app.prefs, 'device', profile.prefs);
  return profile;
}
