// Auto-Rig ① Model compositions (AUTORIG-SPEC §4.5, §5.2; D0 stubs, D3 replaces them): `autorig.sample` (a static
// fixture from `<samplesPath>` through `autorig.intake`, or the shipped `file.loadSample`), `autorig.intake` (sniff the
// file, run one of `mesh.importStatic {dropSkin}`, `file.importModel`, `file.openProject`; return the IntakeReport),
// `autorig.inspect` (the IntakeReport of scene meshes as they are now; U) and `autorig.fix` (center, face, standUp,
// scale, freeze: one inner operator, one undo step).
import type { AnyOperator } from '../../define';
import { wizardStub } from './compose';

export const WIZARD_INTAKE_OPERATORS: readonly AnyOperator[] = [
  wizardStub('autorig.sample', 'Load Auto-Rig Sample'),
  wizardStub('autorig.intake', 'Auto-Rig: Load Model'),
  wizardStub('autorig.inspect', 'Auto-Rig: Inspect Model'),
  wizardStub('autorig.fix', 'Auto-Rig: Fix Model'),
];
