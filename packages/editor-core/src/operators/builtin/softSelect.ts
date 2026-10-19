// Soft selection and the selection settings (M6A-SPEC §6.2, §5.15, §5.6; B12a). All U state in `session.model`
// (never undo steps):
// - `model.softSelect.set {on?, radius?, falloff?, curve?}` and `model.softSelect.toggle` (`B` tap): the weights
//   `w = f(d / r)` the kernel's `softWeights` computes from the expanded selection (B2) for every component transform;
// - `model.selectionStyle.set {style}`: Marquee or Tweak (`` ` `` tap: 'toggle'); 'drag' (paint select) is stretch;
// - `model.cameraBased.set {value}`, `model.backfaces.toggle`: the picking options B10's runtime reads;
// - `model.constraint.set {constraint}`: only 'off' in M6a core (the others are stretch).
// `softWeightsOf` is the weights a component transform of a hilited mesh would use now (the overlay's tint, the test
// API's `softWeights`).
import type { MeshId } from '@ekza-animator/doc';
import type { BitSet, EditMesh } from '@ekza-animator/mesh-core';
import { meshKernel } from '../../mesh';
import { worldPlacement } from '../../mesh/context';
import { componentInternals } from '../../selection/component/service';
import type { EditorApp, SelectionConstraint, SelectionStyle, SoftSelectSettings } from '../../types';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';

/** Falloff presets (§5.15); custom curves are M6a-stretch. */
export const SOFT_CURVES: readonly SoftSelectSettings['curve'][] = [
  'smooth',
  'linear',
  'sharp',
  'root',
  'sphere',
  'constant',
];
export const SOFT_FALLOFFS: readonly SoftSelectSettings['falloff'][] = ['volume', 'surface'];

/** Why the Model-only settings operators poll-fail elsewhere. */
export const MODEL_SETTINGS_REASON = 'Modeling settings are in the Model workspace';
/** Stretch items of the selection options (§1.2). */
export const DRAG_STYLE_LATER = 'Drag selection arrives later';
export const CONSTRAINTS_LATER = 'Selection constraints arrive later';

const STYLES: readonly (SelectionStyle | 'toggle')[] = ['marquee', 'tweak', 'drag', 'toggle'];
const CAMERA_BASED = ['auto', 'on', 'off'] as const;
const CONSTRAINTS: readonly SelectionConstraint[] = ['off', 'angle', 'border', 'loop', 'ring', 'shell'];

const model = { category: 'model', scope: 'model', workspaces: ['model'] } as const;

function inModel(ctx: { readonly app: { readonly session: { getState(): { readonly workspace: string } } } }) {
  return ctx.app.session.getState().workspace === 'model' ? OK : fail(MODEL_SETTINGS_REASON);
}

/** The validated patch of `model.softSelect.set`, or the reason it is not one. */
export function softPatch(raw: unknown): Partial<SoftSelectSettings> | string {
  const expects = 'expects { on?, radius?, falloff?, curve? } with at least one setting';
  if (!isRecord(raw)) return expects;
  const patch: {
    on?: boolean;
    radius?: number;
    falloff?: SoftSelectSettings['falloff'];
    curve?: SoftSelectSettings['curve'];
  } = {};
  if (raw['on'] !== undefined) {
    if (typeof raw['on'] !== 'boolean') return 'on is true or false';
    patch.on = raw['on'];
  }
  if (raw['radius'] !== undefined) {
    if (!isFiniteNumber(raw['radius']) || raw['radius'] <= 0) return 'radius is a distance above 0 (metres)';
    patch.radius = raw['radius'];
  }
  if (raw['falloff'] !== undefined) {
    if (!SOFT_FALLOFFS.includes(raw['falloff'] as SoftSelectSettings['falloff'])) return 'falloff is volume or surface';
    patch.falloff = raw['falloff'] as SoftSelectSettings['falloff'];
  }
  if (raw['curve'] !== undefined) {
    if (!SOFT_CURVES.includes(raw['curve'] as SoftSelectSettings['curve'])) {
      return `curve is one of ${SOFT_CURVES.join(', ')}`;
    }
    patch.curve = raw['curve'] as SoftSelectSettings['curve'];
  }
  return Object.keys(patch).length === 0 ? expects : patch;
}

const softSet = defineOperator({
  id: 'model.softSelect.set',
  label: 'Soft Select Settings',
  description: 'Sets soft selection on/off, radius, falloff and curve.',
  ...model,
  extraArgs: ['on', 'radius', 'falloff', 'curve'],
  poll(_ctx, raw) {
    const patch = softPatch(raw);
    return typeof patch === 'string' ? fail(patch) : OK;
  },
  apply({ app }, raw) {
    const patch = softPatch(raw);
    if (typeof patch === 'string') return;
    const state = app.session.getState();
    const next = { ...state.model.softSelect, ...patch };
    const before = state.model.softSelect;
    if (
      next.on === before.on &&
      next.radius === before.radius &&
      next.falloff === before.falloff &&
      next.curve === before.curve
    ) {
      return;
    }
    app.session.setState({ model: { ...state.model, softSelect: next } });
  },
});

const softToggle = defineOperator({
  id: 'model.softSelect.toggle',
  label: 'Soft Select',
  description: 'Turns soft selection on or off.',
  ...model,
  aliases: ['Proportional Editing'],
  poll: inModel,
  apply({ app }) {
    const state = app.session.getState();
    const soft = state.model.softSelect;
    app.session.setState({ model: { ...state.model, softSelect: { ...soft, on: !soft.on } } });
  },
});

const selectionStyle = defineOperator({
  id: 'model.selectionStyle.set',
  label: 'Selection Style',
  description: 'Switches between marquee and tweak selection.',
  ...model,
  extraArgs: ['style'],
  poll(_ctx, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || !STYLES.includes(args['style'] as SelectionStyle)) {
      return fail('expects { style: marquee | tweak | toggle }');
    }
    return args['style'] === 'drag' ? fail(DRAG_STYLE_LATER) : OK;
  },
  apply({ app }, args) {
    const state = app.session.getState();
    const current = state.model.selectionStyle;
    const style: SelectionStyle = args.style === 'toggle' ? (current === 'tweak' ? 'marquee' : 'tweak') : args.style;
    if (style === 'drag' || style === current) return;
    app.session.setState({ model: { ...state.model, selectionStyle: style } });
  },
});

const cameraBased = defineOperator({
  id: 'model.cameraBased.set',
  label: 'Camera-Based Selection',
  description: 'Selects only components visible from the camera (auto: on in shaded views).',
  ...model,
  extraArgs: ['value'],
  poll(_ctx, raw) {
    const args: unknown = raw;
    return isRecord(args) && CAMERA_BASED.includes(args['value'] as 'auto')
      ? OK
      : fail('expects { value: auto | on | off }');
  },
  apply({ app }, args) {
    const state = app.session.getState();
    if (state.model.cameraBased === args.value) return;
    app.session.setState({ model: { ...state.model, cameraBased: args.value } });
  },
});

const backfaces = defineOperator({
  id: 'model.backfaces.toggle',
  label: 'Select Backfaces',
  description: 'Lets clicks and marquees pick components facing away from the camera.',
  ...model,
  poll: inModel,
  apply({ app }) {
    const state = app.session.getState();
    app.session.setState({ model: { ...state.model, backfaces: !state.model.backfaces } });
  },
});

const constraint = defineOperator({
  id: 'model.constraint.set',
  label: 'Selection Constraint',
  description: 'Constrains selection gestures (angle, border, loop, ring, shell).',
  ...model,
  extraArgs: ['constraint'],
  poll(_ctx, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || !CONSTRAINTS.includes(args['constraint'] as SelectionConstraint)) {
      return fail(`expects { constraint: ${CONSTRAINTS.join(' | ')} }`);
    }
    return args['constraint'] === 'off' ? OK : fail(CONSTRAINTS_LATER);
  },
  apply({ app }, args) {
    const state = app.session.getState();
    if (args.constraint !== 'off' || state.model.constraint === 'off') return;
    app.session.setState({ model: { ...state.model, constraint: 'off' } });
  },
});

export const SOFT_SELECT_OPERATORS: readonly AnyOperator[] = [
  softSet,
  softToggle,
  selectionStyle,
  cameraBased,
  backfaces,
  constraint,
];

/**
 * The soft-selection weights a component transform of `mesh` would use now (§5.15): `w = f(d / r)` from the expanded
 * selection of the current component mode (its vertices weigh 1; hidden vertices 0), distances in world metres
 * through the mesh's placement. Null when soft selection is off, outside a component mode, for a mesh that is not
 * hilited or not ready, or before the kernel has loaded.
 */
export function softWeightsOf(app: EditorApp, mesh: string): Float32Array | null {
  const kernel = meshKernel();
  const state = app.session.getState();
  const soft = state.model.softSelect;
  const kind = state.model.componentMode;
  if (kernel === null || !soft.on || kind === 'object' || !state.model.hilite.includes(mesh as MeshId)) return null;
  const runtime = app.meshes.get(mesh as MeshId);
  const record = app.store.get('meshes', mesh as MeshId);
  const data = runtime?.state === 'ready' ? runtime.data() : null;
  if (runtime === undefined || record === undefined || data === null) return null;
  const m: EditMesh = runtime.mesh ?? kernel.editMeshFrom(data);
  const selection =
    componentInternals(app.components)?.expanded(mesh as MeshId, kind) ?? app.components.get(mesh as MeshId, kind);
  const seeds: BitSet = new kernel.BitSet(m.counts.points);
  const add = (v: number): void => {
    if (v >= 0 && v < m.counts.points) seeds.add(v);
  };
  if (kind === 'vertex') selection.verts.forEach(add);
  else if (kind === 'edge') {
    selection.edges.forEach((e) => {
      if (e >= m.counts.edges) return;
      add(m.edgeVert(e, 0));
      add(m.edgeVert(e, 1));
    });
  } else {
    selection.faces.forEach((f) => {
      if (f >= m.counts.faces) return;
      const first = m.faceCorner(f);
      let c = first;
      let guard = 0;
      do {
        add(m.cornerVert(c));
        c = m.cornerNext(c);
      } while (c !== first && ++guard <= m.counts.corners);
    });
  }
  let hidden: ReturnType<EditorApp['components']['hidden']> | null = null;
  try {
    hidden = app.components.hidden(mesh as MeshId);
  } catch {
    hidden = null;
  }
  return kernel.softWeights(m, seeds, {
    radius: soft.radius,
    falloff: soft.falloff,
    curve: soft.curve,
    placement: worldPlacement(app.store, record),
    hidden,
  });
}
