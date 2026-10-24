// The target chunk (CHARACTER-CONTRACT-SPEC §8; C1): the contract layer of io, the `ekza.targets` table, the target
// operators, the slot statuses, the open-vocabulary check and the `animation` Validation rows. Loaded on the first run
// of a `target.*` id (the runner), by the Target panel and by Auto-Rig ④'s target line — never on a route's first
// visit (`TARGET_CHUNK_MARKER` is the check-size boundary marker). `attachTargets` is idempotent per app.
import { type ContractModel, type ContractTarget, contractOffer, contractTarget } from '@ekza-studio/io';
import { TARGET_OPERATORS } from '../../operators/builtin/target';
import type { EditorApp } from '../../types';
import { targetHooks } from '../targetSlots';
import { contractSlotProblem, targetValidationRows } from './service';
import { ensureTargetTable } from './table';

export { DEFAULT_CONTRACTS_PATH, type LoadedContract, pinnedModel } from './contracts';
export {
  bindingOf,
  contractSlotProblem,
  contractsOf,
  slotStatuses,
  type TargetBinding,
  targetValidationRows,
} from './service';
export {
  clipSeconds,
  computeSlotStatuses,
  contactSeconds,
  type OfferStatus,
  type SlotBinding,
  type SlotClip,
  type SlotCounts,
  type SlotIssue,
  type SlotRow,
  type SlotStatus,
  type SlotStatusKind,
  type SlotStatuses,
} from './status';
export { TARGETS_TABLE, type TargetRecord, targetIdOf, targetOf, targetRecords } from './table';
export { type ContractModel, type ContractTarget, contractOffer, contractTarget };

/** `check-size` marker of the target chunk (never in a route's initial scripts). */
export const TARGET_CHUNK_MARKER = 'ekza-character-target' as const;

const attached = new WeakSet<object>();

/** Registers the table (once per page), the operators and the checks (once per app). */
export function attachTargets(app: EditorApp): void {
  if (typeof TARGET_CHUNK_MARKER !== 'string') throw new Error('target chunk without its marker');
  ensureTargetTable();
  targetHooks({ problem: contractSlotProblem, rows: targetValidationRows });
  if (attached.has(app.operators)) return;
  attached.add(app.operators);
  for (const def of TARGET_OPERATORS) {
    if (app.operators.get(def.id) === undefined) app.contribute({ kind: 'operator', def });
  }
}
