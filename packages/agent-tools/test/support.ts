// Fixtures of the agent-tools tests: a headless editor with Polybot (CC0) loaded through `readSample`, two clips
// (`agent` with keys, `user` active), and a user session with a selection, a band and an override (MCP-SPEC §5.14
// invariant test, §9.2). Also a minimal headless AgentHost.
import type { CharacterId, ClipId, ControlId, KeyId } from '@ekza-animator/doc';
import { seededIdSource } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import {
  createHeadlessEditorApp,
  type EditorApp,
  type ImportResult,
  type RunActor,
  type SampleDef,
} from '@ekza-animator/editor-core';
import type { AgentHost, Grants, HostCapability } from '../src';

export const AGENT: RunActor = { kind: 'agent', id: 'agt_ToolsTest0001', name: 'Tools Test' };
const DEG = Math.PI / 180;

export function readSample(sample: SampleDef): Promise<Uint8Array> {
  return Promise.resolve(readFixture(sample.file as 'polybot.vrm' | 'seed-san.vrm' | 'quaternius-ual.glb'));
}

function runtimeReady(app: EditorApp, character: CharacterId): Promise<void> {
  if (app.characters.get(character) !== undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const off = app.characters.subscribe(() => {
      if (app.characters.get(character) === undefined) return;
      off();
      resolve();
    });
  });
}

async function runOk(app: EditorApp, id: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

export function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

export interface Fixture {
  readonly app: EditorApp;
  readonly character: CharacterId;
  /** The clip an agent edits (keys on fk.lowerArm.L rz at 0, 15, 30). */
  readonly agentClip: ClipId;
  /** The user's active clip. */
  readonly userClip: ClipId;
  readonly keys: readonly KeyId[];
}

/** Polybot with clips `agent` (keyed) and `user` (active), headless. */
export async function polybotFixture(seed = 21): Promise<Fixture> {
  const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(seed) });
  const imported = (await runOk(app, 'file.loadSample', { sample: 'polybot' })) as ImportResult;
  const character = imported.character;
  await runtimeReady(app, character);
  const agentClip = (
    (await runOk(app, 'clip.new', { character, name: 'agent', range: { start: 0, end: 30 } })) as {
      clip: ClipId;
    }
  ).clip;
  const lowerArm = controlOf(app, character, 'fk.lowerArm.L');
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: frame } });
    await runOk(app, 'channel.setValues', {
      edits: [{ control: lowerArm, channel: 'rz', value: degrees * DEG }],
      key: 'force',
    });
  }
  const userClip = (
    (await runOk(app, 'clip.new', { character, name: 'user', range: { start: 0, end: 30 } })) as {
      clip: ClipId;
    }
  ).clip;
  const layer = app.store.query.baseLayer(agentClip);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(agentClip, layer.id, lowerArm, 'rz');
  const keys = curve === undefined ? [] : app.store.query.keysOfCurve(curve.id).map((key) => key.id);
  return { app, character, agentClip, userClip, keys };
}

/** A user session with a selection, a band and an override on the user's clip. */
export function seedUserSession(fx: Fixture): void {
  const { app, character } = fx;
  const hand = controlOf(app, character, 'fk.hand.R');
  const head = controlOf(app, character, 'fk.head');
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, controls: [hand] },
    time: { ...state.time, sceneFrame: 12, band: { start: 5, end: 10 } },
    overrides: new Map([[head, { rx: 10 * DEG }]]),
  });
}

/** A headless AgentHost (grants of §4.4 headless default; capabilities as given). */
export function testHost(opts?: {
  readonly mode?: 'live' | 'headless';
  readonly grants?: Partial<Grants>;
  readonly capabilities?: readonly HostCapability[];
  readonly paused?: () => boolean;
}): AgentHost {
  const grants: Grants = { read: true, edit: true, files: true, view: false, workspace: true, ...opts?.grants };
  return {
    mode: opts?.mode ?? 'headless',
    capabilities: new Set(opts?.capabilities ?? ['capture.schematic', 'files.workspace']),
    grants: () => grants,
    paused: opts?.paused ?? (() => false),
    waitForGesture: () => Promise.resolve(true),
    confirm: () => Promise.resolve('deny'),
    files: null,
  };
}
