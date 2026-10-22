// C3 (skeleton UI; M6B-SPEC §0.2 steps 1–5, §0.4.2, §0.6): the U-state Quick Rig operators and the session helpers the
// Quick Rig panel and the markers tool share. Quick Rig lives in `session.rig.quickRig` (`QuickRigState`): the
// meshes, the template preset, the nine markers (character space; side markers on the character's right, x < 0),
// which ones the user moved, the selected marker, the guess, the start checks, the re-run's skeleton and the preview —
// `quickRigFit` (C2) of the current markers, recomputed on every marker change, so Create Skeleton
// (`skel.quickRig.commit`, C2) writes the last preview bit for bit. Nothing here writes the document or a history step.
//
// - `skel.quickRig.start {meshes?}`: the meshes (args, else the selected objects, else the active character's meshes);
//   runs the start checks, then the One-Click guess (or, on a character with a template skeleton, seeds the markers
//   from its joints: every marker `moved`, the preset locked); switches the viewport to R-Markers and shows the Rig
//   Toolkit. While Quick Rig is open a watcher re-runs the checks after document edits (the Center and Ground / Rotate
//   to Face +Z fixes, their undo) and guesses once they pass; it closes Quick Rig when the workspace changes or the
//   meshes go away.
// - `.setMarker {name, point}` (the markers tool calls `setQuickRigMarker` directly on every pointer frame), `.guess`,
//   `.clear`, `.setPreset {preset}`, `.cancel`, `.pick {marker}`.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import type { MeshId, ReadView } from '@ekza-studio/doc';
import {
  DEFAULT_FLEXION,
  guessMarkers,
  isSkeletonPreset,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  type QuickRigMarker,
  type QuickRigMarkers,
  type SkeletonPreset,
  type TemplateJoint,
} from '@ekza-studio/rig';
import { loadMeshKernel } from '../../../mesh/kernel';
import { PANEL, type EditorApp, type PollResult, type QuickRigState } from '../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../define';
import { CHECK_REASONS, quickRigFit, quickRigStartInfo } from './quickRig';
import { meshesOfObjects, rigGeometry, rigTarget } from './skeleton';

/** Every marker in list order (the pick rule's tie order and the click-to-place order, §0.4.2). */
export const QUICK_RIG_MARKERS: readonly QuickRigMarker[] = Object.freeze([
  ...QUICK_RIG_CENTRE_MARKERS,
  ...QUICK_RIG_SIDE_MARKERS,
]);

/** The marker names the panel list shows (§0.2 step 2). */
export const QUICK_RIG_LABELS: Readonly<Record<QuickRigMarker, string>> = {
  headTop: 'Head top',
  chin: 'Chin / neck',
  pelvis: 'Pelvis',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  knee: 'Knee',
  ankle: 'Ankle',
  toe: 'Toe',
};

/** §0.4.2 T-pose notice (the guess measured an arm angle above 15°). */
export const A_POSE_NOTICE =
  'A-posed arms: the skeleton follows them, but VRM export needs a T-pose — straighten the arms in Model (the A-pose ' +
  'fix arrives after the MVP)';
export const QUICK_RIG_CLOSED = 'Quick Rig is not open';
export const PRESET_LOCKED = 'The template of an existing skeleton is fixed: a new template needs a new skeleton';

const CENTRE: ReadonlySet<QuickRigMarker> = new Set(QUICK_RIG_CENTRE_MARKERS);

/** Whether a marker sits on the centre line (x = 0). */
export function isCentreMarker(name: QuickRigMarker): boolean {
  return CENTRE.has(name);
}

export function isQuickRigMarker(value: unknown): value is QuickRigMarker {
  return typeof value === 'string' && (QUICK_RIG_MARKERS as readonly string[]).includes(value);
}

/** Quick Rig's state, or null while it is closed. */
export function quickRigOf(app: Pick<EditorApp, 'session'>): QuickRigState | null {
  return app.session.getState().rig.quickRig;
}

/** The args of Create Skeleton for the current state (the inputs of the last preview). */
export function quickRigCommitArgs(state: QuickRigState): {
  readonly preset: SkeletonPreset;
  readonly markers: QuickRigMarkers;
  readonly meshes: readonly MeshId[];
  readonly flexion: number;
} {
  return { preset: state.preset, markers: state.markers, meshes: state.meshes, flexion: DEFAULT_FLEXION };
}

/** Why Create Skeleton is disabled now, or null (§0.4.2: every start check must pass; a preview must exist). */
export function quickRigCommitBlock(state: QuickRigState): string | null {
  for (const key of ['centred', 'grounded', 'facing'] as const) if (!state.checks[key]) return CHECK_REASONS[key];
  if (state.preview === null) return 'The meshes are loading';
  return null;
}

/** The next marker a click in the front pane places after Clear: the first missing one in list order. */
export function nextMissingMarker(markers: QuickRigMarkers): QuickRigMarker | null {
  return QUICK_RIG_MARKERS.find((name) => markers[name] === undefined) ?? null;
}

/** A marker point with the centre rule applied: centre markers on x = 0 (+0). */
export function markerPoint(
  name: QuickRigMarker,
  point: readonly [number, number, number],
): readonly [number, number, number] {
  return isCentreMarker(name) ? [0, point[1], point[2]] : [point[0], point[1], point[2]];
}

/** The fit of `markers` over the state's meshes (the preview); null while a mesh is loading. */
function previewOf(
  app: EditorApp,
  view: ReadView,
  state: Pick<QuickRigState, 'preset' | 'markers' | 'meshes'>,
): readonly TemplateJoint[] | null {
  try {
    return quickRigFit(app, view, {
      preset: state.preset,
      markers: state.markers,
      meshes: state.meshes,
      flexion: DEFAULT_FLEXION,
    }).joints;
  } catch (error) {
    if (error instanceof EkzaError && (error.code === 'mesh-loading' || error.code === 'invalid-input')) return null;
    throw error;
  }
}

/** Writes Quick Rig's state (U state); the preview follows the markers and the preset. */
function writeQuickRig(app: EditorApp, next: QuickRigState | null): void {
  const rig = app.session.getState().rig;
  if (rig.quickRig === next) return;
  app.session.setState({ rig: { ...rig, quickRig: next } });
}

function withPreview(app: EditorApp, state: QuickRigState): QuickRigState {
  return { ...state, preview: previewOf(app, app.store, state) };
}

/**
 * Moves one marker (the markers tool's drag frames, click-to-place and `.setMarker`): centre markers keep x = 0; the
 * marker becomes `moved`; the preview is refitted at once (preview = commit). No-op while Quick Rig is closed.
 */
export function setQuickRigMarker(
  app: EditorApp,
  name: QuickRigMarker,
  point: readonly [number, number, number],
  opts?: { readonly select?: boolean },
): void {
  const state = quickRigOf(app);
  if (state === null) return;
  const moved = new Set(state.moved);
  moved.add(name);
  const markers: QuickRigMarkers = { ...state.markers, [name]: markerPoint(name, point) };
  writeQuickRig(
    app,
    withPreview(app, {
      ...state,
      markers,
      moved,
      selected: opts?.select === false ? state.selected : name,
    }),
  );
}

/** Selects a marker (the panel list, the pick rule); U state. */
export function pickQuickRigMarker(app: EditorApp, marker: QuickRigMarker | null): void {
  const state = quickRigOf(app);
  if (state === null || state.selected === marker) return;
  writeQuickRig(app, { ...state, selected: marker });
}

/** Closes Quick Rig (Cancel, `Esc`, leaving the workspace): no document change, no step. */
export function closeQuickRig(app: EditorApp): void {
  writeQuickRig(app, null);
}

// ---------------------------------------------------------------------------------------------------------------------
// start

/** The scene objects Quick Rig starts on: args, else the selection, else the active character's meshes. */
function startObjects(app: EditorApp, view: ReadView, raw: unknown): readonly string[] {
  if (isRecord(raw) && Array.isArray(raw['meshes'])) {
    return (raw['meshes'] as unknown[]).filter((id): id is string => typeof id === 'string');
  }
  const state = app.session.getState();
  // Selected objects that still exist (Create Skeleton adopts the scene meshes under new ids).
  if (meshesOfObjects(view, state.selection.objects).length > 0) return state.selection.objects;
  const character = state.rig.character;
  if (character === null) return [];
  return view.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null)
    .map((mesh) => mesh.id);
}

/** Waits until every mesh's data is resident (the fit reads the meshes' triangles); bounded. */
async function meshesResident(app: EditorApp, meshes: readonly MeshId[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      rigGeometry(app, app.store, meshes);
      return;
    } catch (error) {
      if (!(error instanceof EkzaError) || error.code !== 'mesh-loading') return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface StartPrepared {
  readonly state: QuickRigState;
}

/** The state Quick Rig opens with on `meshes` (start checks, then the guess, or the re-run seeding). */
function openingState(app: EditorApp, meshes: readonly MeshId[]): QuickRigState | string {
  const info = quickRigStartInfo(app, app.store, meshes);
  if (typeof info === 'string') return info;
  const refit = info.refit;
  const preset: SkeletonPreset = info.preset ?? 'standard33';
  const moved = new Set<QuickRigMarker>(
    refit === null ? [] : QUICK_RIG_MARKERS.filter((name) => info.markers[name] !== undefined),
  );
  return withPreview(app, {
    meshes,
    preset,
    markers: info.markers,
    moved,
    selected: null,
    guess: info.guess,
    preview: null,
    checks: info.checks,
    refit,
  });
}

const start = defineOperator<'skel.quickRig.start', StartPrepared>({
  id: 'skel.quickRig.start',
  label: 'Quick Rig…',
  description:
    'Places the nine Quick Rig markers on the selected meshes (One-Click guess) and previews the VRM skeleton (§0.4.2).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  extraArgs: ['meshes'],
  poll(ctx, args): PollResult {
    const target = rigTarget(
      ctx.app.store,
      startObjects(ctx.app, ctx.app.store, args),
      ctx.app.session.getState().rig.character,
    );
    return typeof target === 'string' ? fail(target) : OK;
  },
  async prepare(ctx, args): Promise<StartPrepared> {
    await loadMeshKernel();
    const target = rigTarget(
      ctx.app.store,
      startObjects(ctx.app, ctx.app.store, args),
      ctx.app.session.getState().rig.character,
    );
    if (typeof target === 'string') throw new EkzaError('op-refused', target);
    await meshesResident(ctx.app, target.meshes);
    const state = openingState(ctx.app, target.meshes);
    if (typeof state === 'string') throw new EkzaError('op-refused', state);
    return { state };
  },
  apply(ctx, _args, prepared) {
    const app = ctx.app;
    const session = app.session.getState();
    app.session.setState({
      rig: { ...session.rig, quickRig: prepared.state },
      ...(session.workspace === 'rig' ? { viewportLayout: 'rig-markers' as const, maximizedPane: null } : {}),
    });
    watchQuickRig(app);
    // The panel lives in the Rig Toolkit (§8.6 "Quick Rig stepper when running"): bring its tab forward (the shell's
    // operator; absent in headless apps).
    queueMicrotask(() => {
      if (quickRigOf(app) !== null && app.operators.get('workspace.showPanel') !== undefined) {
        void app.runUntyped('workspace.showPanel', { panel: PANEL.rigToolkit });
      }
    });
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// the watcher (one per app while Quick Rig is open)

const watchers = new WeakMap<EditorApp, Disposer>();

/** True when two check sets are equal. */
function sameChecks(a: QuickRigState['checks'], b: QuickRigState['checks']): boolean {
  return a.centred === b.centred && a.grounded === b.grounded && a.facing === b.facing;
}

/**
 * Re-reads the checks after a document or mesh change; the first time they all pass on a model without markers the
 * guess runs (§0.4.2: "the guess re-runs after the fix"). Meshes that went away close Quick Rig.
 */
function refreshQuickRig(app: EditorApp): void {
  const state = quickRigOf(app);
  if (state === null) return;
  if (state.meshes.some((id) => app.store.get('meshes', id) === undefined)) {
    closeQuickRig(app);
    return;
  }
  let info: ReturnType<typeof quickRigStartInfo>;
  try {
    info = quickRigStartInfo(app, app.store, state.meshes);
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'mesh-loading') return;
    throw error;
  }
  if (typeof info === 'string') {
    closeQuickRig(app);
    return;
  }
  const current = quickRigOf(app);
  if (current === null) return;
  const passing = info.checks.centred && info.checks.grounded && info.checks.facing;
  const empty = QUICK_RIG_MARKERS.every((name) => current.markers[name] === undefined);
  if (passing && empty && current.guess === null && current.refit === null) {
    writeQuickRig(
      app,
      withPreview(app, {
        ...current,
        markers: info.markers,
        moved: new Set(),
        guess: info.guess,
        checks: info.checks,
      }),
    );
    return;
  }
  const next = sameChecks(current.checks, info.checks) ? current : { ...current, checks: info.checks };
  writeQuickRig(app, withPreview(app, next));
}

function watchQuickRig(app: EditorApp): void {
  if (watchers.has(app)) return;
  let pending = false;
  const refresh = (): void => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      refreshQuickRig(app);
    });
  };
  const offStore = app.store.subscribe((batch) => {
    if (batch.origin !== 'preview') refresh();
  });
  const offMeshes = app.meshes.subscribe(() => refresh());
  const offSession = app.session.subscribe((state, previous) => {
    if (state.rig.quickRig !== null && state.workspace !== 'rig' && previous.workspace === 'rig') {
      closeQuickRig(app);
      return;
    }
    if (app.session.getState().rig.quickRig === null) stop();
  });
  const stop = (): void => {
    offStore();
    offMeshes();
    offSession();
    watchers.delete(app);
  };
  watchers.set(app, stop);
}

// ---------------------------------------------------------------------------------------------------------------------
// the other U-state operators

function pollOpen(app: EditorApp): PollResult {
  return quickRigOf(app) === null ? fail(QUICK_RIG_CLOSED) : OK;
}

const setMarker = defineOperator({
  id: 'skel.quickRig.setMarker',
  label: 'Set Marker',
  description: 'Moves a Quick Rig marker (character space; centre markers stay on x = 0).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['name', 'point'],
  poll(ctx, args): PollResult {
    const open = pollOpen(ctx.app);
    if (open !== true) return open;
    if (!isRecord(args) || !isQuickRigMarker(args['name'])) return fail('expects { name, point }');
    const point = args['point'];
    if (!Array.isArray(point) || point.length !== 3 || !point.every((v) => Number.isFinite(v))) {
      return fail('point: [x, y, z]');
    }
    return OK;
  },
  apply(ctx, args) {
    const point = args.point;
    setQuickRigMarker(ctx.app, args.name, [point[0], point[1], point[2]]);
  },
});

interface GuessPrepared {
  readonly markers: QuickRigMarkers;
  readonly guess: QuickRigState['guess'];
}

const guess = defineOperator<'skel.quickRig.guess', GuessPrepared>({
  id: 'skel.quickRig.guess',
  label: 'Guess Markers',
  description: 'Places every Quick Rig marker from the mesh silhouette again (One-Click guess, §0.4.2).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  poll(ctx): PollResult {
    const state = quickRigOf(ctx.app);
    if (state === null) return fail(QUICK_RIG_CLOSED);
    for (const key of ['centred', 'grounded', 'facing'] as const) {
      if (!state.checks[key]) return fail(CHECK_REASONS[key]);
    }
    return OK;
  },
  async prepare(ctx): Promise<GuessPrepared> {
    await loadMeshKernel();
    const state = quickRigOf(ctx.app);
    if (state === null) throw new EkzaError('op-refused', QUICK_RIG_CLOSED);
    await meshesResident(ctx.app, state.meshes);
    const geometry = rigGeometry(ctx.app, ctx.app.store, state.meshes);
    const result = guessMarkers(geometry.bvh, geometry.bounds);
    if (result !== null) {
      return {
        markers: result.markers,
        guess: { armAngle: result.armAngle, aPose: result.aPose, failed: null },
      };
    }
    // No leg split or arm run: the template's proportions on the bounds, as when Quick Rig opened (§0.2 step 2).
    const info = quickRigStartInfo(ctx.app, ctx.app.store, state.meshes);
    if (typeof info === 'string') throw new EkzaError('op-refused', info);
    const fallback =
      info.guess ??
      ({
        armAngle: 0,
        aPose: false,
        failed: 'No leg split or arm run found: the markers follow the template',
      } as const);
    return { markers: info.markers, guess: fallback };
  },
  apply(ctx, _args, prepared) {
    const state = quickRigOf(ctx.app);
    if (state === null) return;
    writeQuickRig(
      ctx.app,
      withPreview(ctx.app, { ...state, markers: prepared.markers, moved: new Set(), guess: prepared.guess }),
    );
  },
});

const clear = defineOperator({
  id: 'skel.quickRig.clear',
  label: 'Clear Markers',
  description: 'Removes every Quick Rig marker; clicks in the front view place them again in list order.',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  poll: (ctx) => pollOpen(ctx.app),
  apply(ctx) {
    const state = quickRigOf(ctx.app);
    if (state === null) return;
    writeQuickRig(ctx.app, withPreview(ctx.app, { ...state, markers: {}, moved: new Set(), selected: null }));
  },
});

const setPreset = defineOperator({
  id: 'skel.quickRig.setPreset',
  label: 'Quick Rig Template',
  description: 'The VRM humanoid template Quick Rig fits: Lite 17, Core 21, Standard 33 or Full 52.',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['preset'],
  poll(ctx, args): PollResult {
    const state = quickRigOf(ctx.app);
    if (state === null) return fail(QUICK_RIG_CLOSED);
    if (!isRecord(args) || !isSkeletonPreset(args['preset'])) return fail('preset: lite17, core21, standard33, full52');
    if (state.refit !== null && args['preset'] !== state.preset) return fail(PRESET_LOCKED);
    return OK;
  },
  apply(ctx, args) {
    const state = quickRigOf(ctx.app);
    if (state === null || state.preset === args.preset) return;
    writeQuickRig(ctx.app, withPreview(ctx.app, { ...state, preset: args.preset }));
  },
});

const cancel = defineOperator({
  id: 'skel.quickRig.cancel',
  label: 'Cancel Quick Rig',
  description: 'Closes Quick Rig without a change (Esc).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  poll: (ctx) => pollOpen(ctx.app),
  apply(ctx) {
    closeQuickRig(ctx.app);
  },
});

const pick = defineOperator({
  id: 'skel.quickRig.pick',
  label: 'Select Marker',
  description: 'Selects a Quick Rig marker (it wins the pick where markers overlap, §0.4.2).',
  category: 'skel',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { internal: true },
  extraArgs: ['marker'],
  poll(ctx, args): PollResult {
    const open = pollOpen(ctx.app);
    if (open !== true) return open;
    if (!isRecord(args) || (args['marker'] !== null && !isQuickRigMarker(args['marker']))) {
      return fail('expects { marker }');
    }
    return OK;
  },
  apply(ctx, args) {
    pickQuickRigMarker(ctx.app, args.marker);
  },
});

export const QUICK_RIG_SESSION_OPERATORS: readonly AnyOperator[] = [
  start,
  setMarker,
  guess,
  clear,
  setPreset,
  cancel,
  pick,
];

/** Whether `meshes` (scene objects) can start Quick Rig, else the reason (the panel's and the Toolkit's buttons). */
export function quickRigStartBlock(app: EditorApp, objects: readonly string[]): string | null {
  const target = rigTarget(app.store, objects, app.session.getState().rig.character);
  return typeof target === 'string' ? target : null;
}
