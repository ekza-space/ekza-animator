// Modeling symmetry (M6A-SPEC §6.2, §5.14; B12a). `model.symmetry.set {meshes?, mode?, tolerance?, preserveSeam?}`
// remembers the mode **per mesh** in `session.model.symmetry` (U state, never an undo step). Default targets: the
// hilited meshes in a component mode, else the selected meshes. A mesh without an entry reads the defaults (off, the
// preferences' tolerance in metres, Preserve Seam on). B7's runtimes build the partner maps from these settings
// (`MeshRuntime.symmetry()`), B6 draws the plane and the mirrored components, B11's tracker closes a Last-op card whose
// targets' symmetry changed.
import type { MeshId } from '@ekza-animator/doc';
import { attachMeshes } from '../../mesh';
import type { EditorApp, OperatorContext, PollResult, SymmetryMode, SymmetrySettings } from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { isEditableMesh, SELECT_A_MESH_FIRST, selectedMeshes } from './mode';

/** Every symmetry mode (§5.14): off, or Object/World X/Y/Z. */
export const SYMMETRY_MODES: readonly SymmetryMode[] = [
  'off',
  'object-x',
  'object-y',
  'object-z',
  'world-x',
  'world-y',
  'world-z',
];

/** Labels of the modes (menus, the Toolkit, the status line). */
export const SYMMETRY_LABELS: Readonly<Record<SymmetryMode, string>> = {
  off: 'Off',
  'object-x': 'Object X',
  'object-y': 'Object Y',
  'object-z': 'Object Z',
  'world-x': 'World X',
  'world-y': 'World Y',
  'world-z': 'World Z',
};

const EXPECTS = 'expects { meshes?, mode?, tolerance?, preserveSeam? } with at least one setting';

/** The settings a mesh reads: its remembered entry, else off with the preferences' tolerance and Preserve Seam on. */
export function symmetryOf(app: Pick<EditorApp, 'session' | 'prefs'>, mesh: string): SymmetrySettings {
  return (
    app.session.getState().model.symmetry.get(mesh as MeshId) ?? {
      mode: 'off',
      tolerance: app.prefs.getState().modeling.symmetryTolerance,
      preserveSeam: true,
    }
  );
}

/** The meshes a symmetry change applies to by default: the hilite in a component mode, else the selected meshes. */
export function symmetryTargets(app: Pick<EditorApp, 'session' | 'store' | 'meshes'>): MeshId[] {
  const model = app.session.getState().model;
  if (model.componentMode !== 'object') return model.hilite.filter((id) => isEditableMesh(app, id));
  return selectedMeshes(app);
}

interface Patch {
  readonly meshes: readonly MeshId[] | null;
  readonly settings: Partial<SymmetrySettings>;
}

function parse(raw: unknown): Patch | string {
  if (!isRecord(raw)) return EXPECTS;
  const settings: { mode?: SymmetryMode; tolerance?: number; preserveSeam?: boolean } = {};
  if (raw['mode'] !== undefined) {
    if (!SYMMETRY_MODES.includes(raw['mode'] as SymmetryMode)) {
      return `mode is one of ${SYMMETRY_MODES.join(', ')}`;
    }
    settings.mode = raw['mode'] as SymmetryMode;
  }
  if (raw['tolerance'] !== undefined) {
    if (!isFiniteNumber(raw['tolerance']) || raw['tolerance'] <= 0) return 'tolerance is a distance above 0 (metres)';
    settings.tolerance = raw['tolerance'];
  }
  if (raw['preserveSeam'] !== undefined) {
    if (typeof raw['preserveSeam'] !== 'boolean') return 'preserveSeam is true or false';
    settings.preserveSeam = raw['preserveSeam'];
  }
  if (Object.keys(settings).length === 0) return EXPECTS;
  let meshes: MeshId[] | null = null;
  if (raw['meshes'] !== undefined) {
    if (!Array.isArray(raw['meshes']) || !raw['meshes'].every((id) => typeof id === 'string')) {
      return 'meshes is a list of mesh ids';
    }
    meshes = raw['meshes'] as MeshId[];
  }
  return { meshes, settings };
}

function targetsOf(ctx: OperatorContext, patch: Patch): MeshId[] | string {
  if (patch.meshes === null) {
    const targets = symmetryTargets(ctx.app);
    return targets.length === 0 ? SELECT_A_MESH_FIRST : targets;
  }
  if (patch.meshes.length === 0) return SELECT_A_MESH_FIRST;
  for (const id of patch.meshes) {
    if (!isEditableMesh(ctx.app, id)) return `Unknown mesh ${id}`;
  }
  return [...patch.meshes];
}

function poll(ctx: OperatorContext, raw: unknown): PollResult {
  const patch = parse(raw);
  if (typeof patch === 'string') return fail(patch);
  const targets = targetsOf(ctx, patch);
  return typeof targets === 'string' ? fail(targets) : OK;
}

const symmetrySet = defineOperator({
  id: 'model.symmetry.set',
  label: 'Symmetry',
  description: 'Sets the symmetry mode, tolerance and seam rule of the hilited or selected meshes.',
  category: 'model',
  scope: 'model',
  extraArgs: ['meshes', 'mode', 'tolerance', 'preserveSeam'],
  workspaces: ['model'],
  poll,
  apply({ app }, raw) {
    const patch = parse(raw);
    if (typeof patch === 'string') return;
    const targets = targetsOf({ app, panel: null, paneId: null }, patch);
    if (typeof targets === 'string') return;
    const state = app.session.getState();
    const next = new Map(state.model.symmetry);
    let changed = false;
    for (const id of targets) {
      const before = symmetryOf(app, id);
      const after: SymmetrySettings = { ...before, ...patch.settings };
      if (
        state.model.symmetry.has(id) &&
        after.mode === before.mode &&
        after.tolerance === before.tolerance &&
        after.preserveSeam === before.preserveSeam
      ) {
        continue;
      }
      next.set(id, after);
      changed = true;
    }
    // The runtimes read the settings through their app binding (B7): bind it before the maps are asked for.
    attachMeshes(app);
    if (changed) app.session.setState({ model: { ...state.model, symmetry: next } });
  },
});

export const SYMMETRY_OPERATORS: readonly AnyOperator[] = [symmetrySet];
