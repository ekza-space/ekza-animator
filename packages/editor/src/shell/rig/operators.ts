// Two Rig & Skin view settings behind the §0.4.5 menu items (C7, M6B-C7-6): Skeleton › Snap to Projected Center ✓
// (`session.rig.snap.projectedCenter`, U state) and Display › Joint Size ▸ (`prefs.rigging.jointSize`). They are
// shell operators (like `workspace.showPanel`), internal (the palette does not list them), registered by the lazy rig
// shell UI; the status line edits the same state.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, OperatorDef, PollResult } from '@ekza-studio/editor-core';

const ok: PollResult = true;
const fail = (reason: string): PollResult => ({ ok: false, reason });
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** The joint display size range (× 0.012·H) and the status line's step. */
export const JOINT_SIZE = { min: 0.25, max: 4, step: 0.25 } as const;
/** Display › Joint Size ▸ presets. */
export const JOINT_SIZES: readonly (readonly [number, string])[] = [
  [0.5, 'Small'],
  [1, 'Medium'],
  [1.5, 'Large'],
  [2, 'Extra Large'],
];

export function rigShellOperators(app: EditorApp): readonly OperatorDef<unknown>[] {
  const snap: OperatorDef<{ readonly on?: boolean }> = {
    id: 'rig.snap.projectedCenter',
    label: 'Snap to Projected Center',
    description: 'Joint moves and placements snap to the middle of the mesh along the view ray.',
    category: 'rig',
    scope: 'rig',
    flags: { internal: true },
    workspaces: ['rig'],
    extraArgs: ['on'],
    poll(_ctx, args) {
      if (args !== undefined && !isRecord(args)) return fail('expects { on? }');
      const on = isRecord(args) ? args['on'] : undefined;
      return on === undefined || typeof on === 'boolean' ? ok : fail('expects { on?: boolean }');
    },
    apply(_ctx, args) {
      const rig = app.session.getState().rig;
      const on = args?.on ?? !rig.snap.projectedCenter;
      app.session.setState({ rig: { ...rig, snap: { ...rig.snap, projectedCenter: on } } });
    },
  };
  const jointSize: OperatorDef<{ readonly size?: number; readonly step?: -1 | 1 }> = {
    id: 'rig.jointSize.set',
    label: 'Joint Size',
    description: 'The size of the joint glyphs (a preference).',
    category: 'rig',
    scope: 'rig',
    flags: { internal: true },
    workspaces: ['rig'],
    extraArgs: ['size', 'step'],
    poll(_ctx, args) {
      if (!isRecord(args)) return fail('expects { size } or { step }');
      const { size, step } = args;
      if (typeof size === 'number' && Number.isFinite(size) && size > 0) return ok;
      return step === 1 || step === -1 ? ok : fail('expects { size } or { step }');
    },
    apply(_ctx, args) {
      const rigging = app.prefs.getState().rigging;
      const next = args.size ?? rigging.jointSize + (args.step ?? 0) * JOINT_SIZE.step;
      const size = Math.min(JOINT_SIZE.max, Math.max(JOINT_SIZE.min, next));
      if (size !== rigging.jointSize) app.prefs.setState({ rigging: { ...rigging, jointSize: size } });
    },
  };
  return [snap, jointSize] as readonly OperatorDef<unknown>[];
}

export function registerRigShellOperators(app: EditorApp): Disposer {
  const disposers = rigShellOperators(app)
    .filter((def) => app.operators.get(def.id) === undefined)
    .map((def) => app.contribute({ kind: 'operator', def }));
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
