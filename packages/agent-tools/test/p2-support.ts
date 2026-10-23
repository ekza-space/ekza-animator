// Fixtures of the P2 tool tests: the D0 Polybot fixture with P1's operators (the real ones once READY.p1, else the
// test doubles), runtimes on a headless host or a host with a simulated user session (live), and helpers to call
// tools and read results.
import type { ClipId, ControlId, KeyId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import {
  type AgentHost,
  type AgentToolResult,
  type AgentToolRuntimeHandle,
  type ConfirmPrompt,
  createAgentToolRuntime,
  type Grants,
  type HostCapability,
} from '../src';
import { withP1 } from './p1-doubles';
import { AGENT, controlOf, type Fixture, polybotFixture, testHost } from './support';

export { AGENT, controlOf };

const DEG = Math.PI / 180;

/**
 * A user session (§5.7): frame 12 and a band 5–10, then a selection (fk.hand.R) and an unkeyed override (fk.head
 * rx 10°) — set after the frame, since the session keeper drops overrides when the frame changes.
 */
export function seedUserSession(fx: Fixture): void {
  const { app, character } = fx;
  const state = app.session.getState();
  app.session.setState({ time: { ...state.time, sceneFrame: 12, band: { start: 5, end: 10 } } });
  app.session.setState({
    selection: { ...app.session.getState().selection, controls: [controlOf(app, character, 'fk.hand.R')] },
    overrides: new Map([[controlOf(app, character, 'fk.head'), { rx: 10 * DEG }]]),
  });
}

/** Resolves once the character's runtime (rig program) exists. */
export function runtimeReady(app: EditorApp, character: Fixture['character']): Promise<void> {
  if (app.characters.get(character) !== undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const off = app.characters.subscribe(() => {
      if (app.characters.get(character) === undefined) return;
      off();
      resolve();
    });
  });
}
export const signal = (): AbortSignal => new AbortController().signal;
export const LIVE: readonly HostCapability[] = ['user', 'confirm', 'presence', 'view', 'capture.schematic'];

export interface P2Fixture extends Fixture {
  /** The app the runtime sees: P1's operators real or doubled. */
  readonly tools: EditorApp;
}

export async function p2Fixture(seed = 41): Promise<P2Fixture> {
  const fx = await polybotFixture(seed);
  return { ...fx, tools: withP1(fx.app) };
}

export interface HostOptions {
  readonly mode?: 'live' | 'headless';
  readonly grants?: Partial<Grants>;
  readonly capabilities?: readonly HostCapability[];
  readonly paused?: () => boolean;
  /** The user's answer to a confirm card (live); a function sees the prompt. Default deny. */
  readonly answer?:
    | 'allow'
    | 'deny'
    | ((
        prompt: ConfirmPrompt,
        signal: AbortSignal,
        resolvedWhen?: () => boolean,
      ) => Promise<'allow' | 'deny' | 'timeout' | 'resolved'>);
  readonly waitForGesture?: AgentHost['waitForGesture'];
  readonly prompts?: ConfirmPrompt[];
}

export function host(opts: HostOptions = {}): AgentHost {
  const base = testHost({
    ...(opts.mode === undefined ? {} : { mode: opts.mode }),
    ...(opts.grants === undefined ? {} : { grants: opts.grants }),
    ...(opts.capabilities === undefined ? {} : { capabilities: opts.capabilities }),
    ...(opts.paused === undefined ? {} : { paused: opts.paused }),
  });
  return {
    ...base,
    ...(opts.waitForGesture === undefined ? {} : { waitForGesture: opts.waitForGesture }),
    confirm(prompt, sig, extra) {
      opts.prompts?.push(prompt);
      const answer = opts.answer ?? 'deny';
      if (typeof answer === 'function') return answer(prompt, sig, extra?.resolvedWhen);
      return Promise.resolve(answer);
    },
  };
}

/** A live host with a simulated user session (§9.3.1): user, confirm, presence and view, Edit granted. */
export function liveHost(opts: HostOptions = {}): AgentHost {
  return host({ mode: 'live', capabilities: LIVE, ...opts });
}

export function runtimeOf(
  fx: P2Fixture,
  h: AgentHost = host(),
  opts?: { readonly gestureWaitMs?: number; readonly confirmTimeoutMs?: number },
): AgentToolRuntimeHandle {
  return createAgentToolRuntime({ app: fx.tools, host: h, actor: AGENT, ...opts });
}

export async function call(
  runtime: AgentToolRuntimeHandle,
  name: string,
  args: unknown,
  sig: AbortSignal = signal(),
): Promise<AgentToolResult<unknown>> {
  return runtime.call(name, args, { signal: sig });
}

/** The data of a successful result, else throws with the error (test diagnostics). */
export function dataOf<T = Record<string, unknown>>(result: AgentToolResult<unknown>): T {
  if (!result.ok) throw new Error(`tool failed: ${JSON.stringify(result.error)}`);
  return result.data as T;
}

export function errorOf(result: AgentToolResult<unknown>): {
  code: string;
  message: string;
  hint: string;
  detail?: Record<string, unknown>;
  candidates?: readonly string[];
} {
  if (result.ok) throw new Error(`tool succeeded: ${JSON.stringify(result.data)}`);
  const { error } = result;
  return {
    ...error,
    ...(error.detail === undefined ? {} : { detail: { ...error.detail } }),
    ...(error.candidates === undefined ? {} : { candidates: [...error.candidates] }),
  };
}

/** Keys (frame → value) of a channel's base-layer curve in a clip, in stored units. */
export function keysOf(app: EditorApp, clip: ClipId, control: ControlId, channel: string): [number, number][] {
  const layer = app.store.query.baseLayer(clip);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as never);
  return curve === undefined ? [] : app.store.query.keysOfCurve(curve.id).map((key) => [key.t, key.v]);
}

/** A write by "another writer" (the user, outside any operator): patches a key value directly. */
export function foreignEdit(app: EditorApp, key: KeyId, value: number): void {
  const record = app.store.get('keys', key);
  if (record === undefined) throw new Error('no key');
  app.store.transact({ label: 'User edit' }, (tx) => tx.put('keys', { ...record, v: value }));
}

/** The user's protected session fields (§5.7) by reference, to compare after a call. */
export function sessionRecord(app: EditorApp): Record<string, unknown> {
  const state = app.session.getState() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of [
    'selection',
    'time',
    'overrides',
    'activeCharacter',
    'activeClip',
    'tools',
    'clipboard',
    'curveBuffers',
    'hiddenControls',
    'showSecondary',
    'viewportLayout',
    'maximizedPane',
    'dialog',
    'feetPins',
  ]) {
    out[field] = state[field];
  }
  out['prefs'] = app.prefs.getState();
  return out;
}
