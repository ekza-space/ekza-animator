// MCP-SPEC §5.14 (D0): the policy table classifies every operator the built-ins register (and the run-time ones of
// viewport, the shell and the curve editor); every allowed and confirm operator run under an actor, on a fixture whose
// user session has a selection, a band, an override and another active clip, keeps the session-state invariant and
// never ends `internal`; and the `prepare` of each of them leaves the session alone (runner rule 6). Operators that
// fail the invariant until P1 migrates them are gated on READY.p1.
import type { KeyId } from '@ekza-animator/doc';
import {
  AGENT_PROTECTED_SESSION_FIELDS,
  type EditorApp,
  NOT_AVAILABLE_YET,
  type OperatorAgentPolicy,
  type OperatorContext,
  type RunContext,
  type RunScope,
} from '@ekza-animator/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { agentPolicyOf, isClassified, OPERATOR_POLICY, UNCLASSIFIED_REASON } from '../src';
import { READY } from './ready';
import { AGENT, controlOf, type Fixture, polybotFixture, seedUserSession } from './support';

/** Operators registered at run time by other packages (viewport, the shell, the curve editor): classified too. */
const RUNTIME_REGISTERED = [
  'view.frame',
  'view.layout',
  'view.toggleMaximize',
  'view.display.toggle',
  'view.lookThrough',
  'view.toggleCameraLock',
  'view.copyViewToShot',
  'view.cameraRadial',
  'view.selectionMask',
  'graph.frame',
  'dopeSheet.frame',
  'graph.view.setMode',
  'select.curveKeys',
  'time.selectBand',
  'ui.open',
  'ui.close',
  'prefs.set',
  'workspace.showPanel',
  'workspace.reset',
];

/**
 * Allowed/confirm operators that write the user's session under an actor until P1 makes them actor-safe: the three of
 * §5.14, and `clip.new`/`clip.duplicate`, whose `activate: false` (§4.10) P1 implements.
 */
const NEEDS_P1 = new Set(['graph.key.insert', 'clip.delete', 'rig.ikFk.matchRange', 'clip.new', 'clip.duplicate']);

describe('operator policy table (MCP-SPEC §5.14)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await polybotFixture();
  });

  it('classifies every registered operator and the run-time ones', () => {
    const ids = fx.app.operators.list().map((def) => def.id);
    expect(ids.length).toBeGreaterThan(100);
    const unclassified = [...ids, ...RUNTIME_REGISTERED].filter(
      (id) => !isClassified(id) && fx.app.operators.get(id)?.agent === undefined,
    );
    expect(unclassified).toEqual([]);
  });

  it('gives every allowed and confirm entry an access class and every denied one a reason', () => {
    for (const [id, policy] of Object.entries(OPERATOR_POLICY)) {
      const complete = policy.policy === 'denied' ? (policy.reason ?? '').length > 0 : policy.access !== undefined;
      expect([id, complete]).toEqual([id, true]);
    }
  });

  it('denies unclassified operators and honours OperatorDef.agent only when trusted', () => {
    const own: OperatorAgentPolicy = { policy: 'allowed', access: 'edit' };
    expect(agentPolicyOf('acme.unknown', undefined)).toEqual({ policy: 'denied', reason: UNCLASSIFIED_REASON });
    expect(agentPolicyOf('acme.unknown', { agent: own })).toEqual({ policy: 'denied', reason: UNCLASSIFIED_REASON });
    expect(agentPolicyOf('acme.unknown', { agent: own }, { trusted: true })).toBe(own);
    expect(agentPolicyOf('edit.undo', undefined).policy).toBe('denied');
    expect(agentPolicyOf('key.write', undefined)).toEqual({ policy: 'allowed', access: 'edit' });
  });

  it('asks before unlocking channels, changing fps or dropping overrides', async () => {
    const { app, character, agentClip } = fx;
    const control = controlOf(app, character, 'fk.lowerArm.L');
    const lock = OPERATOR_POLICY['channel.toggleLock']?.confirmWhen;
    expect(lock?.(app, { refs: [{ control, channel: 'rz' }], locked: true })).toBeNull();
    expect(lock?.(app, { refs: [{ control, channel: 'rz' }], locked: false })).toBeNull(); // not locked yet
    await app.runUntyped('channel.toggleLock', { refs: [{ control, channel: 'rz' }], locked: true });
    expect(lock?.(app, { refs: [{ control, channel: 'rz' }], locked: false })).toBe(
      'AI wants to unlock 1 channel you locked',
    );
    await app.runUntyped('channel.toggleLock', { refs: [{ control, channel: 'rz' }], locked: false });

    const settings = OPERATOR_POLICY['clip.setSettings']?.confirmWhen;
    expect(settings?.(app, { clip: agentClip, slot: 'wave' })).toBeNull();
    expect(settings?.(app, { clip: agentClip, fps: { num: 24, den: 1 } })).toMatch(/frame rate/);
    const setFrame = OPERATOR_POLICY['time.setFrame']?.confirmWhen;
    const overrides = app.session.getState().overrides;
    app.session.setState({ overrides: new Map() });
    expect(setFrame?.(app, { frame: 3 })).toBeNull();
    expect(settings?.(app, { clip: agentClip, loop: true })).toBeNull();
    app.session.setState({ overrides: new Map([[control, { rz: 0.2 }]]) });
    expect(setFrame?.(app, { frame: 3 })).toBe('Moving the playhead drops your 1 unkeyed edit');
    expect(settings?.(app, { clip: agentClip, loop: true })).toBe('This change drops your 1 unkeyed edit');
    app.session.setState({ overrides });
  });
});

type ArgsOf = (fx: Fixture) => { readonly args: unknown; readonly scope?: (fx: Fixture) => RunScope };

/** Hand-written arguments of every allowed and confirm operator (§5.14 second D0 test). */
const ARGS: Readonly<Record<string, ArgsOf>> = {
  // scope-ready (their targets come from the scope)
  'graph.tangent.set': () => ({ args: { type: 'flat' }, scope: keysScope }),
  'graph.tangent.break': () => ({ args: undefined, scope: keysScope }),
  'graph.tangent.unify': () => ({ args: undefined, scope: keysScope }),
  'graph.tangent.lockWeight': () => ({ args: { locked: true }, scope: keysScope }),
  'graph.curve.setWeighted': () => ({ args: { weighted: true }, scope: keysScope }),
  'graph.infinity.set': () => ({ args: { post: 'cycle' }, scope: keysScope }),
  'graph.keys.setFields': () => ({ args: { value: 12 }, scope: keysScope }),
  'graph.curves.simplify': () => ({ args: undefined, scope: keysScope }),
  'graph.eulerFilter': () => ({ args: undefined, scope: keysScope }),
  'key.tween': () => ({ args: { mode: 'tween', amount: 0.5, target: 'keys' }, scope: keysScope }),
  'key.convert': () => ({ args: { to: 'breakdown' }, scope: keysScope }),
  'pose.mirrorAnimation': (fx) => ({
    args: { mode: 'leftToRight', controls: [controlOf(fx.app, fx.character, 'fk.lowerArm.L')] },
    scope: keysScope,
  }),
  // explicit arguments (the M-AI stubs poll-fail "not available yet" until P1)
  'key.write': (fx) => ({ args: { clip: fx.agentClip, keys: [], label: 'Set keys' } }),
  'key.delete': (fx) => ({ args: { clip: fx.agentClip, targets: [], frames: [0], label: 'Delete keys' } }),
  'key.adjust': (fx) => ({ args: { clip: fx.agentClip, targets: [], factor: 1.25, label: 'Adjust' } }),
  'key.retime': (fx) => ({ args: { clip: fx.agentClip, targets: [], mode: 'offset', offset: 2, label: 'Retime' } }),
  'pose.setAt': (fx) => ({ args: { clip: fx.agentClip, frame: 0, edits: [], mode: 'key', label: 'Set pose' } }),
  'pose.goals': (fx) => ({ args: { clip: fx.agentClip, frame: 0, aims: [], label: 'Aim' } }),
  'pose.transfer': (fx) => ({
    args: { clip: fx.agentClip, fromFrame: 0, toFrames: [30], controls: [], mirror: 'none', label: 'Transfer' },
  }),
  'clip.makeLoop': (fx) => ({ args: { clip: fx.agentClip, method: 'matchEnds', rootTravel: 'keep' } }),
  'clip.new': (fx) => ({ args: { character: fx.character, name: 'agentNew', activate: false } }),
  'clip.duplicate': (fx) => ({ args: { clip: fx.agentClip, name: 'agentCopy', activate: false } }),
  'clip.rename': (fx) => ({ args: { clip: fx.agentClip, name: 'agentRenamed' } }),
  'graph.key.insert': (fx) => ({ args: { curve: curveOf(fx), frame: 7 } }),
  'rig.setControlSize': (fx) => ({ args: { control: controlOf(fx.app, fx.character, 'fk.hand.L'), size: 0.05 } }),
  'rig.ikFk.matchRange': (fx) => ({
    args: { limb: 'arm.L', side: 'fk', character: fx.character, clip: fx.agentClip, range: { start: 0, end: 30 } },
  }),
  'channel.toggleLock': (fx) => ({
    args: { refs: [{ control: controlOf(fx.app, fx.character, 'fk.hand.L'), channel: 'rx' }], locked: true },
  }),
  // confirm
  'clip.delete': (fx) => ({ args: { clip: fx.agentClip } }),
  'clip.setSettings': (fx) => ({ args: { clip: fx.agentClip, slot: 'wave' } }),
  'rig.addLimbIk': (fx) => ({ args: { character: fx.character, limbs: ['arm.L'] } }),
  'rig.setFootParams': (fx) => ({ args: { limb: 'leg.L', character: fx.character, params: { heelBack: 0.05 } } }),
  'rig.setRotateOrder': (fx) => ({ args: { control: controlOf(fx.app, fx.character, 'fk.hand.L'), order: 'zyx' } }),
  // view access (exempt from the invariant; they must not end internal)
  'select.controls': (fx) => ({ args: { ids: [controlOf(fx.app, fx.character, 'fk.hand.L')], mode: 'replace' } }),
  'select.keys': (fx) => ({ args: { items: [{ key: fx.keys[0] }], mode: 'replace' } }),
  'select.channels': (fx) => ({
    args: { refs: [{ control: controlOf(fx.app, fx.character, 'fk.hand.L'), channel: 'rz' }], mode: 'replace' },
  }),
  'select.curveKeys': (fx) => ({ args: { curve: curveOf(fx), mode: 'replace' } }),
  'select.none': () => ({ args: undefined }),
  'view.camera.setSettings': (fx) => ({ args: { camera: fx.app.store.list('cameras')[0]?.id, fovY: 0.8 } }),
  'clip.setActive': (fx) => ({ args: { clip: fx.agentClip } }),
  'time.setPlaybackRange': () => ({ args: { range: { start: 0, end: 10 } } }),
  'time.setLoop': () => ({ args: { loop: 'once' } }),
  'time.setSpeed': () => ({ args: { speed: 'half' } }),
  'time.play': () => ({ args: undefined }),
  'time.stop': () => ({ args: undefined }),
  'time.setFrame': () => ({ args: { frame: 3 } }),
};

function curveOf(fx: Fixture): string {
  const control = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
  const layer = fx.app.store.query.baseLayer(fx.agentClip);
  const curve = layer === undefined ? undefined : fx.app.store.query.curveFor(fx.agentClip, layer.id, control, 'rz');
  if (curve === undefined) throw new Error('no curve');
  return curve.id;
}

function keysScope(fx: Fixture): RunScope {
  const keys = new Map(fx.keys.map((key: KeyId) => [key, { key: true, in: true, out: true }]));
  return {
    character: fx.character,
    clip: fx.agentClip,
    selection: { controls: [controlOf(fx.app, fx.character, 'fk.lowerArm.L')], keys },
  };
}

function sessionRecord(app: EditorApp): unknown[] {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  return [...AGENT_PROTECTED_SESSION_FIELDS.map((field) => state[field]), app.prefs.getState()];
}

/** `EkzaError` codes the tool layer maps to a code of its own (§5.4); every other failure is `internal`. */
const MAPPED = new Set(['invalid-record', 'asset-missing', 'read-only']);

const RUN_IDS = Object.entries(OPERATOR_POLICY)
  .filter(([, policy]) => policy.policy !== 'denied')
  .map(([id]) => id);

describe('every allowed and confirm operator under an actor (MCP-SPEC §5.14, runner rule 6)', () => {
  it('has hand-written arguments for every allowed and confirm operator', () => {
    const missing = RUN_IDS.filter((id) => !Object.hasOwn(ARGS, id));
    // view.* and the shell's operators are registered by viewport and the editor only (absent headless).
    expect(missing.filter((id) => !RUNTIME_REGISTERED.includes(id))).toEqual([]);
  });

  for (const id of RUN_IDS.filter((id) => Object.hasOwn(ARGS, id))) {
    const gated = NEEDS_P1.has(id) && !READY.p1;
    it.skipIf(gated)(`${id} keeps the user's session state${NEEDS_P1.has(id) ? ' [P1]' : ''}`, async () => {
      const fx = await polybotFixture();
      seedUserSession(fx);
      // Operators registered by viewport, the shell or the curve editor only are absent headless.
      const registered = fx.app.operators.get(id) !== undefined;
      expect([id, registered || RUNTIME_REGISTERED.includes(id)]).toEqual([id, true]);
      const access = (OPERATOR_POLICY[id] as OperatorAgentPolicy).access ?? 'edit';
      const { args, scope } = (ARGS[id] as ArgsOf)(fx);
      const ctx: RunContext = {
        source: 'api',
        actor: AGENT,
        access,
        ...(scope === undefined ? {} : { runScope: scope(fx) }),
      };
      const before = sessionRecord(fx.app);
      const result = registered
        ? await fx.app.runUntyped(id, args, ctx)
        : ({ status: 'cancelled', reason: 'not registered headless' } as const);
      // View-access runs may change what the user sees (runner rule 6); every other run keeps the session.
      const after = access === 'view' ? before : sessionRecord(fx.app);
      const changed = AGENT_PROTECTED_SESSION_FIELDS.filter((_, i) => after[i] !== before[i]);
      expect([id, changed, after.at(-1) === before.at(-1)]).toEqual([id, [], true]);
      const internal = result.status === 'failed' && !MAPPED.has(result.error.code);
      expect([id, internal ? result.error : null]).toEqual([id, null]);
      fx.app.dispose();
    });
  }

  it('runs the M-AI stubs to a clean "not available yet" refusal', async () => {
    const fx = await polybotFixture();
    for (const id of ['key.write', 'pose.setAt', 'clip.makeLoop', 'edit.revertSteps', 'edit.restoreDocument']) {
      expect(await fx.app.runUntyped(id, { clip: fx.agentClip }, { actor: AGENT, access: 'edit' })).toEqual({
        status: 'cancelled',
        reason: NOT_AVAILABLE_YET,
      });
    }
    fx.app.dispose();
  });

  it("runs each operator's prepare under an actor without writing the session", async () => {
    const fx = await polybotFixture();
    seedUserSession(fx);
    const checked: string[] = [];
    for (const id of RUN_IDS.filter((id) => Object.hasOwn(ARGS, id))) {
      const def = fx.app.operators.get(id);
      if (def?.prepare === undefined) continue;
      const { args, scope } = (ARGS[id] as ArgsOf)(fx);
      const ctx: OperatorContext = {
        app: fx.app,
        panel: null,
        paneId: null,
        source: 'api',
        actor: AGENT,
        runScope: scope === undefined ? null : scope(fx),
        signal: null,
        access: 'edit',
      };
      const before = fx.app.session.getState();
      try {
        await def.prepare(ctx, args);
      } catch {
        // a refused prepare is fine; what matters is that it left the session alone
      }
      expect([id, fx.app.session.getState() === before]).toEqual([id, true]);
      checked.push(id);
    }
    // The allowed/confirm operators with a `prepare` step at v0.2.0 (dispatchers that forward or load).
    expect(checked).toEqual(
      expect.arrayContaining(['clip.new', 'clip.duplicate', 'clip.delete', 'clip.setSettings', 'rig.setRotateOrder']),
    );
    fx.app.dispose();
  });
});
