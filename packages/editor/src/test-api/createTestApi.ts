// The e2e test API (MVP-SPEC §4.8), installed on `window.__EKZA_ANIMATOR_TEST__` in e2e builds opened with
// `?e2e=1`. Reads go through the store, session and evaluation service. The panel-owned slices (viewport panes and
// cameras, Graph Editor and time-slider positions) come from the probes the panels' packages provide; without a
// viewport probe the ViewportManager's public API answers. Functions that take a `control` accept a ControlId or a
// template key of the active character.
import {
  type CompiledAnimCurve,
  type CurveEngine,
  curveEngine,
  EkzaError,
  evaluateAnimCurveSlope,
  keyIndexAt,
  mat4Decompose,
  segmentControlPoints,
} from '@ekza-animator/anim-core';
import {
  BUILTIN_TABLES,
  type CharacterId,
  type CharacterRecord,
  type ClipId,
  type ClipRecord,
  type ControlId,
  type ControlRecord,
  type CurveId,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-animator/doc';
import {
  channelDefaultOf,
  controlVisibility,
  type ManipHandle,
  type OperatorResult,
  type RunContext,
} from '@ekza-animator/editor-core';
import { applyOverrides, controlWorld, footPivotWorlds, type LimbId } from '@ekza-animator/rig';
import { asArtifacts } from '../shell/exports';
import { type Shell, type TweenPanel, tweenProbeKey } from '../shell/types';
import type { EkzaAnimatorTestApi } from './types';

export interface TestApiHandle {
  readonly api: EkzaAnimatorTestApi;
  dispose(): void;
}

type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (element: Element): Rect => {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const defaultValue = (channel: TrsChannel): number => (channel.startsWith('s') ? 1 : 0);

function toBytes(bytes: unknown): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes as number[]);
  if (typeof bytes === 'object' && bytes !== null) {
    // Structured-clone of a typed array through page.evaluate can arrive as {0: …, 1: …}.
    return Uint8Array.from(Object.values(bytes as Record<string, number>));
  }
  throw new EkzaError('invalid-record', 'loadFile: bytes must be a Uint8Array, ArrayBuffer or number[]');
}

/**
 * One-sided slope dv/dt of a compiled curve at a clip frame (M2A-SPEC §4.8 `curveSlope`). Inside a span both sides
 * agree; at a key time the left side is the end slope of the span before it and the right side the start slope of
 * the span after it (exact: from the Bézier control points of the evaluated cubic); outside the key range and at the
 * end keys the infinity decides (constant 0, linear the end slope, cyclic the slope at the wrapped frame).
 */
export function oneSidedSlope(c: CompiledAnimCurve, frame: number, side: 'left' | 'right'): number {
  const n = c.keyCount;
  if (n === 0) return 0;
  const k = keyIndexAt(c, frame, 1e-9);
  if (k === -1) return evaluateAnimCurveSlope(c, frame);
  const points = new Float64Array(8);
  const startSlope = (i: number): number => {
    segmentControlPoints(c, i, points);
    const dt = (points[2] as number) - (points[0] as number);
    return dt === 0 ? 0 : ((points[3] as number) - (points[1] as number)) / dt;
  };
  const endSlope = (i: number): number => {
    segmentControlPoints(c, i, points);
    const dt = (points[6] as number) - (points[4] as number);
    return dt === 0 ? 0 : ((points[7] as number) - (points[5] as number)) / dt;
  };
  const cyclic = (mode: string): boolean => mode === 'cycle' || mode === 'cycleOffset';
  if (side === 'right') {
    if (k < n - 1) return startSlope(k);
    // Past the last key: the post-infinity.
    if (n < 2) return c.post === 'linear' ? (c.outSlope[0] as number) : 0;
    if (c.post === 'linear') return c.outSlope[n - 1] as number;
    if (cyclic(c.post)) return startSlope(0);
    if (c.post === 'oscillate') return -endSlope(n - 2);
    return 0;
  }
  if (k > 0) return endSlope(k - 1);
  // Before the first key: the pre-infinity.
  if (n < 2) return c.pre === 'linear' ? (c.inSlope[0] as number) : 0;
  if (c.pre === 'linear') return c.inSlope[0] as number;
  if (cyclic(c.pre)) return endSlope(n - 2);
  if (c.pre === 'oscillate') return -startSlope(0);
  return 0;
}

function resultOf(result: OperatorResult<unknown>): Awaited<ReturnType<EkzaAnimatorTestApi['run']>> {
  switch (result.status) {
    case 'finished':
      return { status: 'finished', value: result.value };
    case 'cancelled':
      return { status: 'cancelled', reason: result.reason };
    case 'failed':
      return { status: 'failed', error: { code: result.error.code, message: result.error.message } };
  }
}

export function createTestApi(shell: Shell, opts: { readonly engine?: CurveEngine } = {}): TestApiHandle {
  const { app, ui } = shell;
  const engine = opts.engine ?? curveEngine;
  const store = app.store;

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const checkReady = (): void => {
    if (ui.getState().gl.status !== 'pending') resolveReady();
  };
  const unsubscribe = ui.subscribe(checkReady);
  checkReady();

  // ---------- lookups ----------
  const character = (ref?: string): CharacterRecord => {
    const id = ref ?? app.session.getState().activeCharacter;
    if (id === null) throw new EkzaError('invalid-record', 'No active character');
    const record = store.get('characters', id as CharacterId) ?? store.list('characters').find((c) => c.name === id);
    if (record === undefined) throw new EkzaError('invalid-record', `Unknown character '${id}'`);
    return record;
  };
  const control = (ref: string): ControlRecord => {
    const byId = store.get('controls', ref as ControlId);
    if (byId !== undefined) return byId;
    const active = app.session.getState().activeCharacter;
    const rig = active === null ? undefined : store.query.rigOfCharacter(active);
    const byKey = rig === undefined ? undefined : store.query.controlByKey(rig.id, ref);
    if (byKey === undefined) throw new EkzaError('invalid-record', `Unknown control '${ref}'`);
    return byKey;
  };
  const characterOfControl = (record: ControlRecord): CharacterId => {
    const rig = store.get('rigs', record.rig);
    if (rig === undefined) throw new EkzaError('invalid-record', `Control '${record.key}' has no rig`);
    return rig.character;
  };
  const activeClipOf = (charId: CharacterId): ClipRecord | undefined => {
    const clipId = app.session.getState().activeClip[charId];
    return clipId === undefined ? undefined : store.get('clips', clipId);
  };
  const clip = (ref: string): ClipRecord => {
    const byId = store.get('clips', ref as ClipId);
    if (byId !== undefined) return byId;
    const active = app.session.getState().activeCharacter;
    const byName = active === null ? undefined : store.query.clipsOfCharacter(active).find((c) => c.name === ref);
    if (byName === undefined) throw new EkzaError('invalid-record', `Unknown clip '${ref}'`);
    return byName;
  };
  const runtime = (ref?: string) => {
    const record = character(ref);
    const rt = app.characters.get(record.id);
    if (rt === undefined) throw new EkzaError('invalid-record', `Character '${record.name}' has no runtime yet`);
    return { record, rt };
  };
  const nodeIndex = (
    skeleton: {
      readonly humanoid: Readonly<Record<string, number>> | null;
      readonly nodes: readonly { readonly name: string }[];
    },
    name: string,
  ): number => {
    const humanoid = skeleton.humanoid?.[name];
    if (humanoid !== undefined) return humanoid;
    const index = skeleton.nodes.findIndex((node) => node.name === name);
    if (index === -1) throw new EkzaError('invalid-record', `No humanoid bone or node named '${name}'`);
    return index;
  };
  const curveValueAt = (curve: CurveId, frame: number): number =>
    engine.evaluate(app.evaluation.compiledCurve(curve), frame);
  /** Pending once-per-frame tasks (coalesced gesture updates, M2A-SPEC §4.5) apply before a read. */
  const sync = (): void => {
    try {
      app.flushScheduled();
    } catch {
      // A failing task reports itself through its own path; reads still answer.
    }
  };
  /** The pose of a character at a clip frame (default: the current one, with overrides), in a fresh buffer. */
  const poseAt = (charId: CharacterId, clipFrame: number | undefined) => {
    const { rt } = runtime(charId);
    const pose = rt.program.allocPose();
    const clipRecord = activeClipOf(charId);
    if (clipRecord === undefined) {
      const channels = rt.program.allocChannels();
      rt.program.resetChannels(channels);
      rt.program.evaluate(channels, pose);
    } else {
      const frame = clipFrame ?? app.evaluation.clipFrame(charId) ?? 0;
      app.evaluation.evaluateAt(charId, clipRecord.id, frame, pose, { withOverrides: clipFrame === undefined });
    }
    return { rt, pose };
  };
  const xfOf = (matrix: Float64Array) => {
    const xf = mat4Decompose(matrix);
    return {
      t: [xf.t[0], xf.t[1], xf.t[2]] as [number, number, number],
      q: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] as [number, number, number, number],
    };
  };
  const vec3Of = (point: Float64Array): number[] => [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];

  // ---------- panel probes on screen (§4.8) ----------
  // A probe of a panel that is not visible answers null. A panel in an inactive dock tab stays mounted (its probe
  // stays registered) but its canvas is off screen: a zero-size canvas rect means "not visible".
  const onScreen = (rect: { readonly w: number; readonly h: number }): boolean => rect.w > 0 && rect.h > 0;
  const visibleGraph = () => {
    const probe = shell.probes.get('graph');
    const state = probe?.graph() ?? null;
    return probe === null || state === null || !onScreen(state.canvasRect) ? null : { probe, state };
  };
  const visibleDopeSheet = () => {
    const probe = shell.probes.get('dopeSheet');
    const state = probe?.dopeSheet() ?? null;
    return probe === null || state === null || !onScreen(state.canvasRect) ? null : { probe, state };
  };
  /** The Tween bar of `panel`, while that panel is visible (the status-line bar always is). */
  const visibleTween = (panel: TweenPanel) => {
    if (panel === 'graph' && visibleGraph() === null) return null;
    if (panel === 'dopeSheet' && visibleDopeSheet() === null) return null;
    return shell.probes.get(tweenProbeKey(panel));
  };

  // ---------- viewport fallback (no WP-5 probe registered): the ViewportManager's public API ----------
  const viewport = () => {
    const vm = ui.getState().viewport;
    if (vm === null)
      throw new EkzaError('unsupported', 'No ViewportManager (WebGL unavailable or the viewport has not started)');
    return vm;
  };
  const paneElement = (paneId: string): Element | null => {
    const id = CSS.escape(paneId);
    return document.querySelector(`[data-ekza-pane="${id}"],[data-pane-id="${id}"],[data-testid="pane-${id}"]`);
  };
  const onPane = (
    paneId: string,
    point: { readonly x: number; readonly y: number } | null,
  ): { x: number; y: number } | null => {
    const element = paneElement(paneId);
    if (point === null || element === null) return null;
    const r = rectOf(element);
    return { x: r.x + point.x, y: r.y + point.y };
  };

  const api: EkzaAnimatorTestApi = {
    ready,
    get webgl() {
      const gl = ui.getState().gl;
      return { ok: gl.status === 'ready' || gl.status === 'lost', renderer: gl.renderer };
    },
    async run(op, args, ctx) {
      const runContext: RunContext = {
        ...(ctx?.panel === undefined ? {} : { panel: ctx.panel }),
        ...(ctx?.paneId === undefined ? {} : { paneId: ctx.paneId }),
      };
      let result: OperatorResult<unknown>;
      try {
        result = await app.runUntyped(op, args, runContext);
      } catch (error) {
        result = {
          status: 'failed',
          error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
        };
      }
      if (result.status === 'finished' && op === 'file.export') {
        const artifacts = asArtifacts(result.value);
        if (artifacts !== null) shell.exports.recordArtifacts(artifacts);
      }
      return resultOf(result);
    },
    loadFile(name, bytes, opts) {
      return shell.files.openFile(name, toBytes(bytes), {
        ...(opts?.auto === undefined ? {} : { auto: opts.auto }),
        ...(opts?.importOptions === undefined ? {} : { importOptions: opts.importOptions }),
      });
    },
    state() {
      sync();
      const session = app.session.getState();
      const prefs = app.prefs.getState();
      const activeCharacter = session.activeCharacter;
      return {
        clipFrame: activeCharacter === null ? null : app.evaluation.clipFrame(activeCharacter),
        sceneFrame: session.time.sceneFrame,
        playing: session.time.playing,
        layout: session.viewportLayout,
        maximizedPane: session.maximizedPane,
        activeCharacter,
        activeClip: activeCharacter === null ? null : (session.activeClip[activeCharacter] ?? null),
        band: session.time.band === null ? null : { start: session.time.band.start, end: session.time.band.end },
        selection: { controls: [...session.selection.controls], keys: [...session.selection.keys.keys()] },
        history: {
          canUndo: app.history.canUndo(),
          canRedo: app.history.canRedo(),
          undoLabel: app.history.peekUndo()?.label ?? null,
        },
        tool: session.tools.viewport,
        rotateSpace: prefs.rotateSpace,
        autoKey: prefs.autoKey,
        dialog: session.dialog,
        readOnly: store.readOnly,
        keyTarget: session.tools.keyTarget,
        ripple: session.tools.ripple,
        dirty: session.dirty,
        recovery: session.recovery.map((slot) => slot.id),
      };
    },
    counts() {
      sync();
      const counts: Record<string, number> = {};
      for (const table of BUILTIN_TABLES) counts[table] = store.list(table).length;
      return counts;
    },
    characters() {
      sync();
      return store.list('characters').map((c) => ({ id: c.id, name: c.name, format: c.format }));
    },
    controls(ref) {
      sync();
      const record = character(ref);
      const rig = store.query.rigOfCharacter(record.id);
      if (rig === undefined) return [];
      // M2A-SPEC §5.5: the single visibility rule (A0: rule 1; A2 adds the IK/FK rules).
      return store.query.controlsOfRig(rig.id).map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        side: c.side,
        visible: controlVisibility(app, c.id) === 'visible',
        size: c.shape.size,
      }));
    },
    clips(ref) {
      sync();
      const record = character(ref);
      return store.query.clipsOfCharacter(record.id).map((c) => ({
        id: c.id,
        name: c.name,
        fps: c.fps.num / c.fps.den,
        start: c.range.start,
        end: c.range.end,
        loop: c.loop,
        sceneStart: c.sceneStart,
      }));
    },
    curves(clipRef, controlRef) {
      sync();
      const target = clip(clipRef);
      const only = controlRef === undefined ? null : control(controlRef).id;
      return store.query
        .curvesOfClip(target.id)
        .filter((curve) => only === null || curve.control === only)
        .map((curve) => ({
          id: curve.id,
          control: curve.control,
          channel: curve.channel,
          weighted: curve.weighted,
          pre: curve.pre,
          post: curve.post,
          keys: store.query.keysOfCurve(curve.id).map((key) => ({
            id: key.id,
            t: key.t,
            v: key.v,
            inType: key.inType,
            outType: key.outType,
            broken: key.broken,
            inHandle: { dt: key.inHandle.dt, dv: key.inHandle.dv },
            outHandle: { dt: key.outHandle.dt, dv: key.outHandle.dv },
            breakdown: key.breakdown === true,
          })),
        }));
    },
    curveValue(curve, frame) {
      sync();
      if (store.get('curves', curve as CurveId) === undefined)
        throw new EkzaError('invalid-record', `Unknown curve '${curve}'`);
      return curveValueAt(curve as CurveId, frame);
    },
    channelValues(controlRef, clipFrame) {
      sync();
      const record = control(controlRef);
      const charId = characterOfControl(record);
      const current = app.evaluation.clipFrame(charId);
      if (clipFrame === undefined || clipFrame === current) return { ...app.evaluation.channelValues(record.id) };
      const active = activeClipOf(charId);
      const layer = active === undefined ? undefined : store.query.baseLayer(active.id);
      const values: Record<string, number> = {};
      for (const channel of TRS_CHANNELS) {
        const curve =
          active === undefined || layer === undefined
            ? undefined
            : store.query.curveFor(active.id, layer.id, record.id, channel);
        if (curve !== undefined && store.query.keysOfCurve(curve.id).length > 0) {
          values[channel] = curveValueAt(curve.id, clipFrame);
        } else {
          values[channel] = curve?.staticValue ?? defaultValue(channel);
        }
      }
      return values;
    },
    overrides(controlRef) {
      sync();
      const values = app.session.getState().overrides.get(control(controlRef).id);
      const out: Record<string, number> = {};
      if (values === undefined) return out;
      for (const [channel, value] of Object.entries(values)) if (typeof value === 'number') out[channel] = value;
      return out;
    },
    boneWorld(characterRef, name, clipFrame) {
      sync();
      const { record, rt } = runtime(characterRef);
      const node = nodeIndex(rt.skeleton, name);
      const { pose } = poseAt(record.id, clipFrame);
      return xfOf(pose.boneWorld.slice(node * 16, node * 16 + 16));
    },
    facing(characterRef) {
      const { rt } = runtime(characterRef);
      const humanoid = rt.skeleton.humanoid;
      const index = (bone: string): number => {
        const value = humanoid?.[bone as keyof typeof humanoid];
        if (value === undefined) throw new EkzaError('unsupported', `facing() needs the humanoid bone '${bone}'`);
        return value;
      };
      const channels = rt.program.allocChannels();
      rt.program.resetChannels(channels);
      const pose = rt.program.allocPose();
      rt.program.evaluate(channels, pose);
      const at = (bone: string): [number, number, number] => {
        const o = index(bone) * 16;
        return [pose.boneWorld[o + 12] ?? 0, pose.boneWorld[o + 13] ?? 0, pose.boneWorld[o + 14] ?? 0];
      };
      const l = at('leftUpperLeg');
      const r = at('rightUpperLeg');
      const head = at('head');
      const hips = at('hips');
      const a = [l[0] - r[0], l[1] - r[1], l[2] - r[2]] as const;
      const b = [head[0] - hips[0], head[1] - hips[1], head[2] - hips[2]] as const;
      const f: [number, number, number] = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const length = Math.hypot(f[0], f[1], f[2]);
      return length === 0 ? f : [f[0] / length, f[1] / length, f[2] / length];
    },
    panes() {
      const probe = shell.probes.get('viewport');
      if (probe !== null) return probe.panes();
      const vm = ui.getState().viewport;
      return (vm?.paneIds() ?? []).flatMap((id) => {
        const element = paneElement(id);
        return element === null ? [] : [{ id, camera: 'unknown', locked: false, rect: rectOf(element) }];
      });
    },
    cameraOf(paneId) {
      const probe = shell.probes.get('viewport');
      if (probe !== null) return probe.cameraOf(paneId);
      const camera = viewport().camera(paneId);
      return {
        position: [camera.position[0], camera.position[1], camera.position[2]],
        quaternion: [camera.quaternion[0], camera.quaternion[1], camera.quaternion[2], camera.quaternion[3]],
      };
    },
    screenOfControl(controlRef, paneId) {
      const probe = shell.probes.get('viewport');
      if (probe !== null) return probe.screenOfControl(controlRef, paneId);
      return onPane(paneId, viewport().controlScreenPoint(paneId, control(controlRef).id));
    },
    screenOfManipulator(paneId, handle: ManipHandle) {
      const probe = shell.probes.get('viewport');
      if (probe !== null) return probe.screenOfManipulator(paneId, handle);
      return onPane(paneId, viewport().manipulatorScreenPoint(paneId, handle));
    },
    graph: () => {
      const state = visibleGraph()?.state ?? null;
      if (state === null) return null;
      // M2a: the view mode comes from A4's probe ('absolute' before it); buffers are per-user session state.
      const buffers = [...app.session.getState().curveBuffers.keys()];
      return { ...state, viewMode: state.viewMode ?? 'absolute', buffers };
    },
    screenOfKey: (key) => visibleGraph()?.probe.screenOfKey(key) ?? null,
    screenOfHandle: (key, side) => visibleGraph()?.probe.screenOfHandle(key, side) ?? null,
    screenOfCurve: (curve, frame) => visibleGraph()?.probe.screenOfCurve(curve, frame) ?? null,
    screenOfFrame: (frame) => shell.probes.get('timeline')?.screenOfFrame(frame) ?? null,
    screenOfTick: (frame) => shell.probes.get('timeline')?.screenOfTick(frame) ?? null,
    lastExport() {
      const last = shell.exports.last();
      return last === null
        ? null
        : {
            fileName: last.fileName,
            mime: last.mime,
            bytes: last.bytes,
            sha256: last.sha256,
            lints: [...last.lints],
            readBack: last.readBack,
          };
    },
    renderedFrames: () => shell.renderedFrames(),

    // ---------- M2a (M2A-SPEC §4.8) ----------
    attrs(controlRef, clipFrame) {
      sync();
      const record = control(controlRef);
      const charId = characterOfControl(record);
      if (clipFrame === undefined || clipFrame === app.evaluation.clipFrame(charId)) {
        return { ...app.evaluation.attrValues(record.id) };
      }
      const active = activeClipOf(charId);
      const layer = active === undefined ? undefined : store.query.baseLayer(active.id);
      const values: Record<string, number> = {};
      for (const name of Object.keys(record.attrs ?? {})) {
        const channel = `@${name}` as const;
        const curve =
          active === undefined || layer === undefined
            ? undefined
            : store.query.curveFor(active.id, layer.id, record.id, channel);
        if (curve !== undefined && store.query.keysOfCurve(curve.id).length > 0) {
          values[name] = curveValueAt(curve.id, clipFrame);
        } else {
          values[name] = curve?.staticValue ?? channelDefaultOf(record, channel);
        }
      }
      return values;
    },
    controlWorld(controlRef, clipFrame) {
      sync();
      const record = control(controlRef);
      const { rt, pose } = poseAt(characterOfControl(record), clipFrame);
      return xfOf(controlWorld(rt.program, pose, record.id));
    },
    curveSlope(curve, frame, side) {
      sync();
      if (store.get('curves', curve as CurveId) === undefined) {
        throw new EkzaError('invalid-record', `Unknown curve '${curve}'`);
      }
      if (side !== 'left' && side !== 'right') throw new EkzaError('unsupported', "side is 'left' or 'right'");
      return oneSidedSlope(app.evaluation.compiledCurve(curve as CurveId), frame, side);
    },
    limbs(characterRef) {
      sync();
      const { record, rt } = runtime(characterRef);
      return rt.program.limbs.map((limb) => ({
        id: limb.id,
        ikFk: app.evaluation.ikFk(record.id, limb.id) ?? 0,
        ikControl: limb.params.ikControl,
        pole: limb.params.pole,
        fk: [...limb.fkControls],
      }));
    },
    limbPivots(characterRef, limbId) {
      sync();
      const { record } = runtime(characterRef);
      const { rt, pose } = poseAt(record.id, undefined);
      const limb = rt.program.limbs.find((candidate) => candidate.id === limbId);
      if (limb === undefined || limb.params.foot === null) return null;
      // The channels of that pose: curves at the current frame, then the session overrides.
      const channels = rt.program.allocChannels();
      const clipRecord = activeClipOf(record.id);
      if (clipRecord === undefined) rt.program.resetChannels(channels);
      else rt.sampler(clipRecord.id).sample(app.evaluation.clipFrame(record.id) ?? 0, channels);
      applyOverrides(rt.program, channels, app.session.getState().overrides);
      const pivots = footPivotWorlds(rt.program, pose, channels, limbId as LimbId);
      if (pivots === null) return null;
      return {
        heel: vec3Of(pivots.heel),
        ball: vec3Of(pivots.ball),
        toe: vec3Of(pivots.toe),
        inner: vec3Of(pivots.inner),
        outer: vec3Of(pivots.outer),
      };
    },
    dopeSheet: () => visibleDopeSheet()?.state ?? null,
    screenOfDopeKey: (row, frame) => visibleDopeSheet()?.probe.screenOfDopeKey(row, frame) ?? null,
    screenOfDopeRegion: (part) => visibleDopeSheet()?.probe.screenOfDopeRegion(part) ?? null,
    timelineTicks: () => shell.probes.get('timeline')?.timelineTicks?.() ?? [],
    screenOfBand: (part) => shell.probes.get('timeline')?.screenOfBand?.(part) ?? null,
    screenOfRegionHandle: (handle) => visibleGraph()?.probe.screenOfRegionHandle?.(handle) ?? null,
    screenOfTween: (panel, amount) => visibleTween(panel)?.screenOfTween(amount) ?? null,
    tweenTarget: (panel) => visibleTween(panel)?.tweenTarget() ?? null,
    autosave() {
      const status = app.session.getState().autosave;
      return {
        enabled: status.enabled,
        slot: status.slot,
        lastSavedAt: status.lastSavedAt,
        pending: status.pending,
      };
    },
    async flushAutosave() {
      // `file.autosaveNow` writes the slot now and resolves after the IndexedDB transaction (A5).
      const result = await app.runUntyped('file.autosaveNow');
      if (result.status === 'failed') throw new EkzaError(result.error.code, result.error.message);
      if (result.status === 'cancelled') throw new EkzaError('unsupported', `flushAutosave: ${result.reason}`);
    },
  };

  // Every probe-backed read sees the pending once-per-frame updates too (the kernel-level reads call `sync` above).
  for (const name of SYNCED_PROBE_READS) {
    const read = api[name] as (...args: unknown[]) => unknown;
    (api as unknown as Record<string, unknown>)[name] = (...args: unknown[]): unknown => {
      sync();
      return read(...args);
    };
  }

  return {
    api,
    dispose(): void {
      unsubscribe();
    },
  };
}

/** Test API reads answered by panel probes or the ViewportManager (screen positions, panel state). */
const SYNCED_PROBE_READS = [
  'panes',
  'cameraOf',
  'screenOfControl',
  'screenOfManipulator',
  'graph',
  'screenOfKey',
  'screenOfHandle',
  'screenOfCurve',
  'screenOfFrame',
  'screenOfTick',
  'dopeSheet',
  'screenOfDopeKey',
  'screenOfDopeRegion',
  'timelineTicks',
  'screenOfBand',
  'screenOfRegionHandle',
  'screenOfTween',
  'tweenTarget',
] as const satisfies readonly (keyof EkzaAnimatorTestApi)[];
