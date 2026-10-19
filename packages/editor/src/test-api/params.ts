// URL parameters of the editor (MVP-SPEC §4.8). They take effect only in e2e builds (NEXT_PUBLIC_EKZA_E2E=1)
// opened with `?e2e=1`; ordinary builds ignore them, so no URL can switch a user's editor into test mode. The one
// exception is M6a `ws=<id>` (M6A-SPEC §4.8): a deep link to a workspace, read in any build.
import type { NavProfile } from '@ekza-animator/editor-core';

export interface EditorParams {
  /** e2e mode: fresh storage, seeded IDs, no UI transitions, the test API on window. */
  readonly e2e: boolean;
  /** `firstRun=1`: show the first-run dialog even in e2e mode. */
  readonly firstRun: boolean;
  readonly nav: Extract<NavProfile, 'maya' | 'trackpad'> | null;
  readonly space: 'maya' | 'play' | null;
  readonly platform: 'mac' | 'other' | null;
  /**
   * M2a `ns=<string>`: the storage namespace (localStorage prefix and IndexedDB database suffix), so a reload of the
   * same URL sees the same storage; null = a fresh namespace per page load (M1).
   */
  readonly ns: string | null;
  /** M2a `storage=blocked`: every storage access throws (NFR-12 e2e). */
  readonly storageBlocked: boolean;
  /** M2a `pointerLock=off`: the virtual slider uses pointer capture instead of Pointer Lock (§5.18). */
  readonly pointerLock: boolean;
  /** M6a `ws=<id>` (any build): open this workspace when it is registered and enabled; null = the remembered one. */
  readonly ws: string | null;
}

export const DEFAULT_PARAMS: EditorParams = {
  e2e: false,
  firstRun: false,
  nav: null,
  space: null,
  platform: null,
  ns: null,
  storageBlocked: false,
  pointerLock: true,
  ws: null,
};

/** A storage namespace from the URL: 1–64 characters of [A-Za-z0-9_-]; anything else is ignored. */
const NAMESPACE = /^[A-Za-z0-9_-]{1,64}$/;
/** A workspace id from the URL ('model', 'animate', …); anything else is ignored. */
const WORKSPACE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function parseEditorParams(search: string, buildAllowsE2e: boolean): EditorParams {
  const query = new URLSearchParams(search);
  const wsParam = query.get('ws');
  const ws = wsParam !== null && WORKSPACE_ID.test(wsParam) ? wsParam : null;
  if (!buildAllowsE2e || query.get('e2e') !== '1') return ws === null ? DEFAULT_PARAMS : { ...DEFAULT_PARAMS, ws };
  const nav = query.get('nav');
  const space = query.get('space');
  const platform = query.get('platform');
  const ns = query.get('ns');
  return {
    e2e: true,
    firstRun: query.get('firstRun') === '1',
    nav: nav === 'maya' || nav === 'trackpad' ? nav : null,
    space: space === 'maya' || space === 'play' ? space : null,
    platform: platform === 'mac' || platform === 'other' ? platform : null,
    ns: ns !== null && NAMESPACE.test(ns) ? ns : null,
    storageBlocked: query.get('storage') === 'blocked',
    pointerLock: query.get('pointerLock') !== 'off',
    ws,
  };
}

/** True when the build allows e2e mode and the URL asks for it (`?e2e=1`). */
export function isE2eRequested(buildAllowsE2e: boolean, search: string): boolean {
  return parseEditorParams(search, buildAllowsE2e).e2e;
}

/** macOS (Cmd as `mod`, ⌘ labels) or anything else. */
export function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const data = (navigator as Navigator & { readonly userAgentData?: { readonly platform?: string } }).userAgentData;
  const name = data?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other';
}
