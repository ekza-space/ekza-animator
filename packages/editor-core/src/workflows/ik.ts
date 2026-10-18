// Limb IK in the editor (M2A-SPEC §5.5–§5.8, A2): which limb a control belongs to, the limbs of a character's
// compiled rig, and the IK/FK workflows the `rig.*` IK operators run (match, switch keys, foot parameters). The rig
// math (matching, the ik2 op, the records) is A1's (`@ekza-animator/rig`); this file only reads compiled
// `RigProgram.limbs` and writes channels through the edit kernel.
import type { CharacterId, ControlId } from '@ekza-animator/doc';
import type { LimbDesc, LimbId, RigProgram } from '@ekza-animator/rig';
import type { EditorApp } from '../types';

/** Display names of the limbs ('L Leg'), used in labels, warnings and menus. */
export const LIMB_NAME: Readonly<Record<LimbId, string>> = {
  'leg.L': 'L Leg',
  'leg.R': 'R Leg',
  'arm.L': 'L Arm',
  'arm.R': 'R Arm',
};

/** The compiled limbs of a character's rig (none without a runtime or without `ik2` solvers). */
export function limbsOf(app: EditorApp, character: CharacterId | null): readonly LimbDesc[] {
  if (character === null) return [];
  return app.characters.get(character)?.program.limbs ?? [];
}

/**
 * The limb a control belongs to for the IK/FK UI (§5.6 "any selected control of a limb"): its FK chain
 * (`fk.upper`, `fk.mid`, `fk.end`, and `fk.toes` of legs), its IK control or its pole; null otherwise.
 */
export function limbOfControlIn(program: RigProgram, control: ControlId): LimbDesc | null {
  for (const limb of program.limbs) {
    const { fk, ikControl, pole } = limb.params;
    if (
      control === ikControl ||
      control === pole ||
      control === fk.upper ||
      control === fk.mid ||
      control === fk.end ||
      (fk.toes !== null && control === fk.toes)
    ) {
      return limb;
    }
  }
  return null;
}

/** `limbOfControlIn` over the control's character runtime (null without a runtime). */
export function limbOfControlApp(app: EditorApp, control: ControlId): LimbDesc | null {
  const record = app.store.get('controls', control);
  if (record === undefined) return null;
  const character = app.store.get('rigs', record.rig)?.character;
  const program = character === undefined ? undefined : app.characters.get(character)?.program;
  return program === undefined ? null : limbOfControlIn(program, control);
}
