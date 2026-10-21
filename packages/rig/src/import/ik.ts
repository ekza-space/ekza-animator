import { eulerNear, type Frame, type KeyData, type Vec3 } from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import { internalsOf, isRigOpSkipped, type RigInternals } from '../kernel/internals';
import { matchIkToFk } from '../limb/match';
import { LIMB_TEMPLATES } from '../limb/template';
import {
  type ChannelBuffer,
  type ImportedClipKeys,
  type ImportedCurve,
  type ImportRawOptions,
  LIMB_IDS,
  type LimbDesc,
  type PoseBuffers,
  type RigProgram,
} from '../types';
import type { ControlSolver, GroupMode, SlotKeys } from './core';

// Import to IK (M2A-SPEC §5.8, research 07 §15.4): for every limb whose `ikFk` default is ≥ 0.5, the importer
// matches IK to the solved FK pose at every key time of the limb's influencing controls (the FK chain and its
// control ancestors: hips and `cog` motion moves the foot too) and writes keys on the IK control (t, r) and the pole
// (t) instead of the FK chain. Before writing, the fidelity check compares the IK result with the FK pose (chain
// bone world rotations and the mid-joint position); a limb over the tolerance stays FK for the clip with one stepped
// `@ikFk` key 0 at the clip start and a warning.

/** §5.8 default fidelity tolerance: 2° and 2 mm (M2A-D13). */
export const DEFAULT_IK_TOLERANCE = { rotationRad: 0.03490658503988659, positionM: 0.002 } as const;

type LimbRow = NonNullable<ImportedClipKeys['limbs']>[number];

interface LimbPlan {
  readonly desc: LimbDesc;
  readonly ikSlot: number;
  readonly poleSlot: number;
  readonly chainSlots: readonly number[];
  readonly keys: SlotKeys;
  readonly times: ReadonlySet<number>;
  maxRotation: number;
  maxMid: number;
  previousIk: ChannelValues | null;
  previousPole: ChannelValues | null;
}

/** Combined tangent mode of the contributing channel groups (never Hermite: IK keys are derived values). */
function combinedMode(modes: readonly GroupMode[]): GroupMode {
  if (modes.length === 0) return 'linear';
  if (modes.every((mode) => mode === 'step')) return 'step';
  if (modes.some((mode) => mode === 'auto' || mode === 'hermite')) return 'auto';
  return 'linear';
}

/** The IK side of one clip import; `null` from `createImportIk` when no limb is imported to IK. */
export class ImportIk {
  /** Key plans of the IK and pole controls by control slot. */
  readonly extraSlots = new Map<number, SlotKeys>();
  private readonly limbs: LimbPlan[];
  private readonly ch: ChannelBuffer;
  private readonly fkPose: PoseBuffers;
  private readonly euler: Vec3 = [0, 0, 0];
  private readonly q: [number, number, number, number] = [0, 0, 0, 1];
  private skipped: Set<number> | null = null;

  constructor(
    private readonly program: RigProgram,
    private readonly internals: RigInternals,
    limbs: readonly LimbDesc[],
    slots: readonly (SlotKeys | null)[],
    private readonly tolerance: { readonly rotationRad: number; readonly positionM: number },
    private readonly clipName: string,
    private readonly range: { readonly start: Frame; readonly end: Frame },
  ) {
    this.ch = program.allocChannels();
    this.fkPose = program.allocPose();
    this.limbs = [];
    for (const desc of limbs) {
      const p = desc.params;
      const ikSlot = program.controlIndex.get(p.ikControl);
      const poleSlot = program.controlIndex.get(p.pole);
      if (ikSlot === undefined || poleSlot === undefined) continue;
      const contributing = new Set<number>();
      for (const id of [p.fk.upper, p.fk.mid, p.fk.end]) {
        for (
          let slot = program.controlIndex.get(id) ?? -1;
          slot !== -1;
          slot = internals.controlParent[slot] as number
        ) {
          contributing.add(slot);
        }
      }
      const secondsByFrame = new Map<Frame, number>();
      const modes: GroupMode[] = [];
      for (const slot of contributing) {
        const keys = slots[slot];
        if (keys === null || keys === undefined || keys.frames.length === 0) continue;
        modes.push(keys.rotation, keys.translation);
        keys.frames.forEach((frame, i) => {
          const seconds = keys.seconds[i] as number;
          const current = secondsByFrame.get(frame);
          if (current === undefined || seconds < current) secondsByFrame.set(frame, seconds);
        });
      }
      const frames = [...secondsByFrame.keys()].sort((a, b) => a - b);
      const mode = combinedMode(modes);
      const keys: SlotKeys = {
        frames,
        seconds: frames.map((frame) => secondsByFrame.get(frame) as number),
        rotation: mode,
        translation: mode,
        scale: 'linear',
      };
      const chainSlots = [p.fk.upper, p.fk.mid, p.fk.end].map((id) => program.controlIndex.get(id) as number);
      this.limbs.push({
        desc,
        ikSlot,
        poleSlot,
        chainSlots,
        keys,
        times: new Set(keys.seconds),
        maxRotation: 0,
        maxMid: 0,
        previousIk: null,
        previousPole: null,
      });
      if (frames.length > 0) {
        this.extraSlots.set(ikSlot, keys);
        this.extraSlots.set(poleSlot, keys);
      }
    }
  }

  /**
   * After the control solver ran at `seconds`: evaluates the solved FK pose (every IK limb at ikFk 0) and matches
   * each limb keyed at this time; `write(slot, key, values)` stores tx…sz of a key of the IK or pole control.
   */
  match(
    seconds: number,
    solver: ControlSolver,
    write: (slot: number, key: number, values: readonly number[]) => void,
  ): void {
    const due = this.limbs.filter((limb) => limb.times.has(seconds));
    if (due.length === 0) return;
    const { program, internals, ch, euler, q } = this;
    program.resetChannels(ch);
    const local = solver.local;
    for (let slot = 0; slot < internals.controlCount; slot++) {
      const o = slot * 9;
      ch.values[o] = local.t[slot * 3] as number;
      ch.values[o + 1] = local.t[slot * 3 + 1] as number;
      ch.values[o + 2] = local.t[slot * 3 + 2] as number;
      for (let c = 0; c < 4; c++) q[c] = local.q[slot * 4 + c] as number;
      euler[0] = 0;
      euler[1] = 0;
      euler[2] = 0;
      eulerNear(q, internals.rotateOrders[slot] ?? 'xyz', euler, euler);
      ch.values[o + 3] = euler[0];
      ch.values[o + 4] = euler[1];
      ch.values[o + 5] = euler[2];
      ch.values[o + 6] = local.s[slot * 3] as number;
      ch.values[o + 7] = local.s[slot * 3 + 1] as number;
      ch.values[o + 8] = local.s[slot * 3 + 2] as number;
    }
    for (const limb of this.limbs) {
      const slot = limb.desc.attrSlots.ikFk;
      if (slot >= 0) ch.attrs[slot] = 0;
    }
    program.evaluate(ch, this.fkPose);
    for (const limb of due) {
      const p = limb.desc.params;
      const reference = new Map<ControlId, ChannelValues>();
      if (limb.previousIk !== null) reference.set(p.ikControl, limb.previousIk);
      if (limb.previousPole !== null) reference.set(p.pole, limb.previousPole);
      const result = matchIkToFk(program, this.fkPose, ch, limb.desc.id, reference);
      limb.maxRotation = Math.max(limb.maxRotation, result.maxRotationErrorRad);
      limb.maxMid = Math.max(limb.maxMid, result.midErrorM);
      const ik = result.values.get(p.ikControl) ?? {};
      const pole = result.values.get(p.pole) ?? {};
      limb.previousIk = ik;
      limb.previousPole = pole;
      const key = limb.keys.seconds.indexOf(seconds);
      write(limb.ikSlot, key, [ik.tx ?? 0, ik.ty ?? 0, ik.tz ?? 0, ik.rx ?? 0, ik.ry ?? 0, ik.rz ?? 0, 1, 1, 1]);
      write(limb.poleSlot, key, [pole.tx ?? 0, pole.ty ?? 0, pole.tz ?? 0, 0, 0, 0, 1, 1, 1]);
    }
  }

  /** Decides each limb's mode (§5.8 fidelity check) after every key time was matched. */
  finish(): {
    readonly skip: ReadonlySet<number>;
    readonly curves: readonly ImportedCurve[];
    readonly rows: readonly LimbRow[];
    readonly warnings: readonly string[];
  } {
    const skip = new Set<number>();
    const curves: ImportedCurve[] = [];
    const rows: LimbRow[] = [];
    const warnings: string[] = [];
    for (const limb of this.limbs) {
      const fk = limb.maxRotation > this.tolerance.rotationRad || limb.maxMid > this.tolerance.positionM;
      rows.push({
        limb: limb.desc.id,
        mode: fk ? 'fk' : 'ik',
        maxRotationErrorRad: limb.maxRotation,
        maxMidErrorM: limb.maxMid,
      });
      if (!fk) {
        for (const slot of limb.chainSlots) skip.add(slot);
        continue;
      }
      skip.add(limb.ikSlot);
      skip.add(limb.poleSlot);
      const key: KeyData = {
        t: this.range.start,
        v: 0,
        inType: 'flat',
        outType: 'step',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      };
      curves.push({
        control: limb.desc.params.ikControl,
        channel: '@ikFk',
        keys: [key],
        stats: { sourceKeys: 1, maxReduceError: 0 },
      });
      const t = LIMB_TEMPLATES[limb.desc.id];
      warnings.push(
        `${t.label} kept FK in '${this.clipName}': the ${t.joint} is not a clean hinge (max ${((limb.maxRotation * 180) / Math.PI).toFixed(1)}°, ${Math.round(limb.maxMid * 1000)} mm). Rig › IK/FK › Match Range to IK converts it if you accept the difference.`,
      );
    }
    this.skipped = skip;
    return { skip, curves, rows, warnings };
  }

  /** Slots whose curves are not written (set by `finish`). */
  get skip(): ReadonlySet<number> {
    return this.skipped ?? new Set();
  }
}

/**
 * The IK side of an import (§5.8), or null with `ik: 'none'` or when the rig has no limb whose `ikFk` default is
 * ≥ 0.5 (skipped ops count as FK).
 */
export function createImportIk(
  program: RigProgram,
  slots: readonly (SlotKeys | null)[],
  opts: ImportRawOptions,
  clipName: string,
  range: { readonly start: Frame; readonly end: Frame },
): ImportIk | null {
  if (opts.ik === 'none') return null;
  // Rows and warnings in LIMB_IDS order (legs before arms, left before right), whatever the solver ids.
  const limbs = program.limbs
    .filter((limb) => {
      if (isRigOpSkipped(program, limb.solver)) return false;
      const slot = limb.attrSlots.ikFk;
      const def = slot >= 0 ? program.attrSlots[slot]?.def : undefined;
      return def !== undefined && def.default >= 0.5;
    })
    .sort((a, b) => LIMB_IDS.indexOf(a.id) - LIMB_IDS.indexOf(b.id));
  if (limbs.length === 0) return null;
  const tolerance = opts.ikTolerance ?? DEFAULT_IK_TOLERANCE;
  return new ImportIk(program, internalsOf(program), limbs, slots, tolerance, clipName, range);
}
