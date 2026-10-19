// Soft selection and the selection settings (M6A-SPEC §6.2, §5.15, §5.6; B12a). All U state in `session.model`
// (never undo steps):
// - `model.softSelect.set {on?, radius?, falloff?, curve?}` and `model.softSelect.toggle` (`B` tap): the weights
//   `w = f(d / r)` the kernel's `softWeights` computes from the expanded selection (B2) for every component transform;
// - `model.selectionStyle.set {style}`: Marquee or Tweak (`` ` `` tap: 'toggle'); 'drag' (paint select) is stretch;
// - `model.cameraBased.set {value}`, `model.backfaces.toggle`: the picking options B10's runtime reads;
// - `model.constraint.set {constraint}`: only 'off' in M6a core (the others are stretch).
import type { SelectionConstraint, SelectionStyle, SoftSelectSettings } from '../../types';
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
    // 'toggle' (the options marking menu's ✓ item): off ↔ on, from auto to off.
    return isRecord(args) && (CAMERA_BASED.includes(args['value'] as 'auto') || args['value'] === 'toggle')
      ? OK
      : fail('expects { value: auto | on | off }');
  },
  apply({ app }, args) {
    const state = app.session.getState();
    const current = state.model.cameraBased;
    const raw = args.value as (typeof CAMERA_BASED)[number] | 'toggle';
    const value = raw === 'toggle' ? (current === 'off' ? 'on' : 'off') : raw;
    if (current === value) return;
    app.session.setState({ model: { ...state.model, cameraBased: value } });
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
