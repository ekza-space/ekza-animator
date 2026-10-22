// Auto-Rig ⑤ Export composition (AUTORIG-SPEC §4.5, §5.6; D0 stub, D6 replaces it): `autorig.export {character,
// target, fileName}` — `ekza-vrm` / `glb` through `runExportCharacter` (Studio's bytes by construction), `vrma` through
// the shipped export pipeline, `omoba-kit` = the VRM bytes packed by io's `packOmobaKit`; no undo step (a download).
import type { AnyOperator } from '../../define';
import { wizardStub } from './compose';

export const WIZARD_EXPORT_OPERATORS: readonly AnyOperator[] = [wizardStub('autorig.export', 'Download Character')];
