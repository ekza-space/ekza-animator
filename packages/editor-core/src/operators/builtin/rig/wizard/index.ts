// The Auto-Rig compositions (AUTORIG-SPEC §4.5; D0, closed): every `autorig.*` operator from its owner's file (one
// line per file), appended to the rig-workspace chunk's operators (`RIG_WORKSPACE_OPERATORS`), so the runner loads the
// chunk on the first run of an `autorig.*` id from any shell, the palette or the MCP bridge (`isRigWorkspaceOperator`).
// Named `WIZARD_*`, never `AUTORIG_*`: that is M6b's control-rig generator (`./autorig.ts`, `rig.autoRig.update`).
import type { AnyOperator } from '../../define';
import { WIZARD_CLIP_OPERATORS } from './clip';
import { WIZARD_EXPORT_OPERATORS } from './export';
import { WIZARD_INTAKE_OPERATORS } from './intake';
import { WIZARD_NAVIGATE_OPERATORS } from './navigate';
import { WIZARD_RIG_OPERATORS } from './rig';

export {
  ARRIVES_WITH_AUTORIG,
  COMPOSITION_INTERRUPTED,
  type CompositionOutcome,
  type CompositionStep,
  runComposition,
} from './compose';

/** Every Auto-Rig composition, by owner file (D3 intake, D4 rig, D5 clip, D6 export, D1 navigate). */
export const WIZARD_OPERATORS: readonly AnyOperator[] = [
  ...WIZARD_INTAKE_OPERATORS,
  ...WIZARD_RIG_OPERATORS,
  ...WIZARD_CLIP_OPERATORS,
  ...WIZARD_EXPORT_OPERATORS,
  ...WIZARD_NAVIGATE_OPERATORS,
];
