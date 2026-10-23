// URL parameters of the editor (MVP-SPEC §4.8). They take effect only in e2e builds (NEXT_PUBLIC_EKZA_E2E=1)
// opened with `?e2e=1`; ordinary builds ignore them, so no URL can switch a user's editor into test mode. The
// exceptions are M6a `ws=<id>` (M6A-SPEC §4.8), a deep link to a workspace, and AUTORIG-SPEC §3.1/§4.4's `handoff=<id>`
// (a one-shot handoff record to open) and `from=studio|autorig` (labels the entry), read in any build.
import type { NavProfile } from '@ekza-studio/editor-core';

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
  /** AUTORIG-SPEC §4.4 `handoff=<id>` (any build): the handoff record this page opens, read once; null = none. */
  readonly handoff: string | null;
  /** AUTORIG-SPEC §3.1 `from=studio|autorig` (any build): the shell the user came from (a label only). */
  readonly from: 'studio' | 'autorig' | null;
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
  handoff: null,
  from: null,
};

/** A storage namespace from the URL: 1–64 characters of [A-Za-z0-9_-]; anything else is ignored. */
const NAMESPACE = /^[A-Za-z0-9_-]{1,64}$/;
/** A workspace id from the URL ('model', 'animate', …); anything else is ignored. */
const WORKSPACE_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** A handoff record id (a UUID; any 8–64 characters of [A-Za-z0-9-]); anything else is ignored. */
const HANDOFF_ID = /^[A-Za-z0-9-]{8,64}$/;

export function parseEditorParams(search: string, buildAllowsE2e: boolean): EditorParams {
  const query = new URLSearchParams(search);
  const wsParam = query.get('ws');
  const handoffParam = query.get('handoff');
  const fromParam = query.get('from');
  // Read in any build: deep links and the shell switch (M6a `ws`, AUTORIG-SPEC `handoff`, `from`).
  const links = {
    ws: wsParam !== null && WORKSPACE_ID.test(wsParam) ? wsParam : null,
    handoff: handoffParam !== null && HANDOFF_ID.test(handoffParam) ? handoffParam : null,
    from: fromParam === 'studio' || fromParam === 'autorig' ? fromParam : null,
  } as const;
  if (!buildAllowsE2e || query.get('e2e') !== '1') {
    return links.ws === null && links.handoff === null && links.from === null
      ? DEFAULT_PARAMS
      : { ...DEFAULT_PARAMS, ...links };
  }
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
    ...links,
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

// ---------- M-AI (MCP-SPEC §4.9) ----------
/** The bridge ports an editor outside e2e mode accepts from `agentPort` (§5.10). */
export const AGENT_PORT_RANGE = { first: 47_821, last: 47_830 } as const;
/** At most this many ports in `agentPort`. */
export const AGENT_PORTS_MAX = 10;

/**
 * Agent URL parameters (MCP-SPEC §4.9). Their header promise holds: no URL switches a user's editor into test mode or
 * makes it connect anywhere by itself. `agentPort=<port>[,<port>…]`: in e2e builds opened with `?e2e=1` any loopback
 * ports 1024…65535 (at most ten), and the panel connects at start; in every other build only ports inside 47821–47830
 * are accepted (others are ignored) and the parameter only opens the Agent panel with those ports preselected —
 * nothing is sent before the user clicks [Connect]. `agentGestureWaitMs` and `agentConfirmTimeoutMs` only in e2e
 * builds opened with `?e2e=1`.
 */
export interface AgentParams {
  readonly agentPorts: readonly number[];
  /** Open the Agent panel at start (a valid `agentPort` was given). */
  readonly openPanel: boolean;
  /** Connect at start without a click (e2e builds opened with `?e2e=1` only). */
  readonly connectAtStart: boolean;
  readonly gestureWaitMs: number | null;
  readonly confirmTimeoutMs: number | null;
}

export const DEFAULT_AGENT_PARAMS: AgentParams = {
  agentPorts: [],
  openPanel: false,
  connectAtStart: false,
  gestureWaitMs: null,
  confirmTimeoutMs: null,
};

function msParam(value: string | null): number | null {
  if (value === null || !/^\d{1,7}$/.test(value)) return null;
  const ms = Number(value);
  return ms <= 600_000 ? ms : null;
}

export function parseAgentParams(search: string, buildAllowsE2e: boolean): AgentParams {
  const query = new URLSearchParams(search);
  const e2e = buildAllowsE2e && query.get('e2e') === '1';
  const raw = query.get('agentPort');
  const ports: number[] = [];
  for (const part of (raw ?? '').split(',')) {
    if (!/^\d{1,5}$/.test(part)) continue;
    const port = Number(part);
    const allowed = e2e
      ? port >= 1_024 && port <= 65_535
      : port >= AGENT_PORT_RANGE.first && port <= AGENT_PORT_RANGE.last;
    if (allowed && !ports.includes(port)) ports.push(port);
    if (ports.length === AGENT_PORTS_MAX) break;
  }
  return {
    agentPorts: ports,
    openPanel: ports.length > 0,
    connectAtStart: e2e && ports.length > 0,
    gestureWaitMs: e2e ? msParam(query.get('agentGestureWaitMs')) : null,
    confirmTimeoutMs: e2e ? msParam(query.get('agentConfirmTimeoutMs')) : null,
  };
}
