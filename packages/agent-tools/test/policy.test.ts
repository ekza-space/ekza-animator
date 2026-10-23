// MCP-SPEC §5.14 (D0): the policy table classifies every operator the built-ins register (and the run-time ones of
// viewport, the shell and the curve editor); every allowed and confirm operator run under an actor, on a fixture whose
// user session has a selection, a band, an override and another active clip, keeps the session-state invariant,
// never ends `internal` and ends exactly as recorded per operator (finished, or the reason it refuses); and the
// `prepare` of each of them leaves the session alone (runner rule 6). Operators that fail the invariant until P1
// migrates them are gated on READY.p1, and READY.p1 switches the expected outcomes to P1's (the scope-ready operators
// then must finish on the scope's keys), so P1's migration is visible and cannot regress silently.
import type { KeyId } from '@ekza-studio/doc';
import {
  AGENT_PROTECTED_SESSION_FIELDS,
  type EditorApp,
  NOT_AVAILABLE_YET,
  type OperatorAgentPolicy,
  type OperatorContext,
  type OperatorResult,
  type RunContext,
  type RunScope,
} from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { agentPolicyOf, allTools, isClassified, OPERATOR_POLICY, tablePolicyOf, UNCLASSIFIED_REASON } from '../src';
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

  it('never answers an inherited object member as a policy (deny by default)', () => {
    const operatorRun = allTools().find((tool) => tool.name === 'operator_run');
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect([id, agentPolicyOf(id, undefined)]).toEqual([id, { policy: 'denied', reason: UNCLASSIFIED_REASON }]);
      expect([id, isClassified(id), tablePolicyOf(id)]).toEqual([id, false, undefined]);
      const access = operatorRun?.access;
      expect([id, typeof access === 'function' ? access({ id }, 'headless') : access]).toEqual([id, 'edit']);
    }
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
  'key.tween': () => ({ args: { mode: 'tween', amount: 0.5, target: 'keys' }, scope: middleKeyScope }),
  'key.convert': () => ({ args: { to: 'breakdown' }, scope: keysScope }),
  'pose.mirrorAnimation': (fx) => ({
    args: { mode: 'leftToRight', controls: [controlOf(fx.app, fx.character, 'fk.lowerArm.L')] },
    scope: keysScope,
  }),
  // explicit arguments (D0's stubs poll-failed "not available yet"; P1 runs them on explicit targets)
  'key.write': (fx) => ({
    args: { clip: fx.agentClip, keys: [{ ...armZ(fx, 'fk.hand.L'), frame: 5, value: 0.2 }], label: 'Set keys' },
  }),
  'key.delete': (fx) => ({ args: { clip: fx.agentClip, targets: [armZ(fx)], frames: [15], label: 'Delete keys' } }),
  'key.adjust': (fx) => ({ args: { clip: fx.agentClip, targets: [armZ(fx)], factor: 1.25, label: 'Adjust' } }),
  'key.retime': (fx) => ({
    args: { clip: fx.agentClip, targets: [armZ(fx)], mode: 'offset', offset: 2, label: 'Retime' },
  }),
  'pose.setAt': (fx) => ({
    args: {
      clip: fx.agentClip,
      frame: 0,
      edits: [{ ...armZ(fx, 'fk.hand.L'), value: 0.3 }],
      mode: 'key',
      label: 'Set pose',
    },
  }),
  'pose.goals': (fx) => ({
    args: {
      clip: fx.agentClip,
      frame: 10,
      aims: [{ bone: 'leftUpperArm', direction: [0.8, 0.6, 0], keepTwist: true, weight: 1 }],
      label: 'Aim',
    },
  }),
  'pose.transfer': (fx) => ({
    args: {
      clip: fx.agentClip,
      fromFrame: 15,
      toFrames: [30],
      controls: [controlOf(fx.app, fx.character, 'fk.lowerArm.L')],
      mirror: 'none',
      label: 'Transfer',
    },
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

/** The `rz` channel target of a control (default the keyed fk.lowerArm.L). */
function armZ(fx: Fixture, key = 'fk.lowerArm.L'): { readonly control: string; readonly channel: 'rz' } {
  return { control: controlOf(fx.app, fx.character, key), channel: 'rz' };
}

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

/** The middle key only (frame 15): a tween needs unselected keys on both sides. */
function middleKeyScope(fx: Fixture): RunScope {
  const middle = fx.keys[1] as KeyId;
  return {
    ...keysScope(fx),
    selection: { ...keysScope(fx).selection, keys: new Map([[middle, { key: true, in: true, out: true }]]) },
  };
}

/** How a run ended: `finished` (with its value), `refused: <reason>` (cancelled or poll-failed) or `failed: <code>`. */
function outcomeOf(result: OperatorResult<unknown>): string {
  if (result.status === 'finished')
    return result.value === undefined ? 'finished' : `finished ${JSON.stringify(result.value)}`;
  if (result.status === 'cancelled') return `refused: ${result.reason}`;
  return `failed: ${result.error.code}`;
}

/** The allowed operators whose targets come from the run scope (`operator_run {context}`); P1 migrates them. */
const SCOPE_READY = [
  'graph.tangent.set',
  'graph.tangent.break',
  'graph.tangent.unify',
  'graph.tangent.lockWeight',
  'graph.curve.setWeighted',
  'graph.infinity.set',
  'graph.keys.setFields',
  'graph.curves.simplify',
  'graph.eulerFilter',
  'key.tween',
  'key.convert',
  'pose.mirrorAnimation',
];
/** The §4.10 operators D0 registers as stubs; P1 implements them. */
const P1_STUBS = [
  'key.write',
  'key.delete',
  'key.adjust',
  'key.retime',
  'pose.setAt',
  'pose.goals',
  'pose.transfer',
  'clip.makeLoop',
];

/**
 * What each run under an actor ends with in D0. The scope-ready operators still read the user's session, not the
 * scope: most refuse because the user has no keys selected, and `graph.eulerFilter`/`pose.mirrorAnimation` finish
 * without touching the scope's keys (count 0). `rig.addLimbIk` refuses because Polybot's arms have IK already (its
 * confirm path is covered by the policy's `confirmWhen` and P3's wire examples). `select.curveKeys` is registered by
 * the curve editor only.
 */
const EXPECTED_D0: Readonly<Record<string, string>> = {
  'graph.tangent.set': 'refused: No curves to edit',
  'graph.tangent.break': 'refused: No keys are selected',
  'graph.tangent.unify': 'refused: No keys are selected',
  'graph.tangent.lockWeight': 'refused: No curves to edit',
  'graph.curve.setWeighted': 'refused: No curves to edit',
  'graph.infinity.set': 'refused: No curves to edit',
  'graph.keys.setFields': 'refused: No keys are selected',
  'graph.curves.simplify': 'refused: No curves to edit',
  'graph.eulerFilter': 'finished {"count":0}',
  'key.tween': 'refused: Nothing to tween: the selected keys need unselected keys before and after them',
  'key.convert': 'refused: No keys are selected or at the current frame',
  'pose.mirrorAnimation': 'finished {"count":0}',
  ...Object.fromEntries(P1_STUBS.map((id) => [id, `refused: ${NOT_AVAILABLE_YET}`])),
  'clip.rename': 'finished',
  'rig.setControlSize': 'finished',
  'channel.toggleLock': 'finished',
  'clip.setSettings': 'finished',
  'rig.addLimbIk': 'refused: Those limbs have IK already',
  'rig.setFootParams': 'finished',
  'rig.setRotateOrder': 'finished',
  'select.controls': 'finished',
  'select.keys': 'finished',
  'select.channels': 'finished',
  'select.curveKeys': 'refused: not registered headless',
  'select.none': 'finished',
  'clip.setActive': 'finished',
  'view.camera.setSettings': 'finished',
  'time.setPlaybackRange': 'finished',
  'time.setLoop': 'finished',
  'time.setSpeed': 'finished',
  'time.play': 'finished',
  'time.stop': 'finished',
  'time.setFrame': 'finished',
};

/**
 * P1's outcomes (MCP-SPEC §8 P1, pinned when P1 landed): every scope-ready operator finishes on the scope's keys, the
 * explicit-target operators run on their explicit targets, and the five gated operators run. Generated ids and the
 * solved aim are matched by pattern.
 */
const EXPECTED_P1: Readonly<Record<string, string | RegExp>> = {
  'graph.tangent.set': 'finished',
  'graph.tangent.break': 'finished',
  'graph.tangent.unify': 'finished',
  'graph.tangent.lockWeight': 'finished',
  'graph.curve.setWeighted': 'finished',
  'graph.infinity.set': 'finished',
  'graph.keys.setFields': 'finished',
  'graph.curves.simplify': 'finished {"before":3,"after":3,"maxError":0}',
  'graph.eulerFilter': 'finished {"count":0}',
  'key.tween': 'finished {"count":1}',
  'key.convert': 'finished {"count":3}',
  'pose.mirrorAnimation': 'finished {"count":1}',
  'key.write': 'finished {"written":1,"curvesCreated":1,"rangeExtended":false,"hiddenByOverrides":[]}',
  'key.delete': 'finished {"deleted":1}',
  'key.adjust': 'finished {"keys":3,"curves":1,"skipped":[]}',
  'key.retime': 'finished {"moved":3,"merged":0,"clamped":0,"snapped":0,"contactFrame":null}',
  'pose.setAt': 'finished {"keyed":1,"synced":2,"statics":0,"skipped":[],"hiddenByOverrides":[]}',
  'pose.goals':
    /^finished \{"aims":\[\{"bone":"leftUpperArm","control":"[^"]+","achieved":\[[^\]]+\],"errorRad":[0-9.e-]+\}\],"ik":\[\],"keyed":3\}$/,
  'pose.transfer': 'finished {"keyed":3}',
  'clip.makeLoop':
    'finished {"before":{"maxC0":0,"maxC1":0,"worst":[]},"after":{"maxC0":0,"maxC1":0,"worst":[]},"curvesChanged":1}',
  'clip.new': /^finished \{"clip":"clp_[A-Za-z0-9]+"\}$/,
  'clip.duplicate': /^finished \{"clip":"clp_[A-Za-z0-9]+"\}$/,
  'graph.key.insert': /^finished \{"key":"k_[A-Za-z0-9]+"\}$/,
  'rig.ikFk.matchRange': 'finished {"count":279}',
  'clip.delete': 'finished',
};

/**
 * The outcome a run must have: D0's record, or with READY.p1 P1's pinned outcome for the operators P1 implements or
 * migrates. Returns `actual` when a pinned pattern accepts it, else what was expected.
 */
function expectedOutcome(id: string, actual: string): string {
  const pinned = READY.p1 && Object.hasOwn(EXPECTED_P1, id) ? EXPECTED_P1[id] : undefined;
  if (pinned === undefined) return EXPECTED_D0[id] ?? '(no outcome recorded)';
  if (typeof pinned === 'string') return pinned;
  return pinned.test(actual) ? actual : `(matching ${String(pinned)})`;
}

function sessionRecord(app: EditorApp): unknown[] {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  return [...AGENT_PROTECTED_SESSION_FIELDS.map((field) => state[field]), app.prefs.getState()];
}

/** `EkzaError` codes the tool layer maps to a code of its own (§5.4); every other failure is `internal`. */
const MAPPED = new Set(['invalid-record', 'asset-missing', 'read-only']);

/**
 * MCP-SPEC §0.4.4 (B4): the allowed and confirm operators of the lazy rig-workspace and clip-library chunks (absent
 * from this fixture until loaded) are run under an actor, with their session checks, by the setup tools' tests
 * (`setup-tools.test.ts`) on static models.
 */
const SETUP_ROWS = new Set([
  'autorig.inspect',
  'autorig.fix',
  'autorig.clip.add',
  'autorig.rig',
  'autorig.sample',
  'autorig.intake',
  'library.useClip',
]);

const RUN_IDS = Object.entries(OPERATOR_POLICY)
  .filter(([id, policy]) => policy.policy !== 'denied' && !SETUP_ROWS.has(id))
  .map(([id]) => id);

describe('every allowed and confirm operator under an actor (MCP-SPEC §5.14, runner rule 6)', () => {
  it('has hand-written arguments for every allowed and confirm operator', () => {
    const missing = RUN_IDS.filter((id) => !Object.hasOwn(ARGS, id));
    // view.* and the shell's operators are registered by viewport and the editor only (absent headless).
    expect(missing.filter((id) => !RUNTIME_REGISTERED.includes(id))).toEqual([]);
  });

  it('records an expected outcome for every operator it runs', () => {
    const ran = RUN_IDS.filter((id) => Object.hasOwn(ARGS, id) && !NEEDS_P1.has(id));
    expect(ran.filter((id) => !Object.hasOwn(EXPECTED_D0, id))).toEqual([]);
    expect(Object.keys(EXPECTED_D0).filter((id) => !ran.includes(id))).toEqual([]);
    expect(SCOPE_READY.filter((id) => (OPERATOR_POLICY[id] as OperatorAgentPolicy).policy !== 'allowed')).toEqual([]);
    // P1 pins an outcome for every operator it implements or migrates, and the scope-ready ones say so in the table.
    const p1 = [...SCOPE_READY, ...P1_STUBS, ...NEEDS_P1];
    expect(p1.filter((id) => !Object.hasOwn(EXPECTED_P1, id))).toEqual([]);
    expect(SCOPE_READY.filter((id) => OPERATOR_POLICY[id]?.runScope !== true)).toEqual([]);
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
      const outcome = outcomeOf(result);
      expect([id, outcome]).toEqual([id, expectedOutcome(id, outcome)]);
      fx.app.dispose();
    });
  }

  it('runs the M-AI operators to a clean refusal on incomplete arguments (D0: the stubs\' "not available yet")', async () => {
    const fx = await polybotFixture();
    const p1: Readonly<Record<string, string>> = {
      'key.write': 'expects exactly one of keys or poseAt',
      'pose.setAt': 'frame must be a finite frame',
      'clip.makeLoop': 'method is one of matchEnds, blend, cycleOnly',
      'edit.revertSteps': 'expects { steps: [step ids] }',
      'edit.restoreDocument': 'Restoring the document is the user’s action',
    };
    for (const [id, reason] of Object.entries(p1)) {
      expect([id, await fx.app.runUntyped(id, { clip: fx.agentClip }, { actor: AGENT, access: 'edit' })]).toEqual([
        id,
        { status: 'cancelled', reason: READY.p1 ? reason : NOT_AVAILABLE_YET },
      ]);
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
