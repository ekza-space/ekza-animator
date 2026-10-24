// The target chunk's per-app state (CHARACTER-CONTRACT-SPEC §8.1–§8.3; C1): the contract service and the slot
// statuses of a character read from the document (memoized by the document version), the open-vocabulary check
// `clip.setSettings` asks for contract slots, and the Validation rows of area `animation`.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { type ContractModel, contractTarget, OMOBA_PACKAGE_PROFILE_ID } from '@ekza-studio/io';
import type { EditorApp, RigValidationRow } from '../../types';
import { ContractService, type ContractServiceOptions, pinnedModel } from './contracts';
import { namedMarkers } from './markers';
import { computeSlotStatuses, type SlotClip, type SlotStatuses } from './status';
import { type TargetRecord, targetOf } from './table';

const services = new WeakMap<EditorApp, ContractService>();

/** The app's contract service (created on first use). */
export function contractsOf(app: EditorApp, opts?: ContractServiceOptions): ContractService {
  let service = services.get(app);
  if (service === undefined) {
    service = new ContractService(app, opts);
    services.set(app, service);
  }
  return service;
}

/** The binding of a character: its target and the pinned contract's model (or why it cannot be read). */
export type TargetBinding =
  | { readonly target: TargetRecord; readonly model: ContractModel; readonly error: null }
  | { readonly target: TargetRecord; readonly model: null; readonly error: string };

export function bindingOf(app: Pick<EditorApp, 'store'>, character: CharacterId): TargetBinding | null {
  const target = targetOf(app.store, character);
  if (target === undefined) return null;
  const model = pinnedModel(target);
  return model instanceof EkzaError ? { target, model: null, error: model.message } : { target, model, error: null };
}

/** The live clips of a character with their named markers (`ekza.clipMarkers`). */
export function slotClips(app: Pick<EditorApp, 'store'>, character: CharacterId): readonly SlotClip[] {
  return app.store.query
    .clipsOfCharacter(character)
    .filter((clip) => clip.deleted === null)
    .map((clip) => {
      const markers = namedMarkers(app.store, clip.id);
      return Object.keys(markers).length === 0 ? clip : { ...clip, markers };
    });
}

const memo = new WeakMap<object, Map<CharacterId, { readonly version: number; readonly value: SlotStatuses | null }>>();

/**
 * The slot statuses of a character's target (§8.3), or null when it has none (or its contract cannot be read). Pure
 * over the document: memoized by the store version.
 */
export function slotStatuses(app: Pick<EditorApp, 'store'>, character: CharacterId): SlotStatuses | null {
  let byCharacter = memo.get(app.store);
  if (byCharacter === undefined) {
    byCharacter = new Map();
    memo.set(app.store, byCharacter);
  }
  const hit = byCharacter.get(character);
  if (hit !== undefined && hit.version === app.store.version) return hit.value;
  const binding = bindingOf(app, character);
  const value =
    binding === null || binding.model === null
      ? null
      : computeSlotStatuses(binding.model, binding.target, slotClips(app, character));
  byCharacter.set(character, { version: app.store.version, value });
  return value;
}

/** Why `clip` cannot take the contract slot `slot` (the open vocabulary, §8.2), or null. */
export function contractSlotProblem(
  app: EditorApp,
  character: CharacterId,
  clip: ClipId | null,
  slot: string,
  opts: { readonly moving?: boolean } = {},
): string | null {
  const binding = bindingOf(app, character);
  if (binding === null) return `'${slot}' is a target slot: set a target for the character first`;
  if (binding.model === null) return binding.error;
  const view = contractTarget(binding.model, binding.target.target);
  const spec = binding.model.slots[slot];
  if (view === undefined || spec === undefined || !view.slots.includes(slot)) {
    return `'${slot}' is not a slot of ${view?.name ?? binding.target.target}`;
  }
  if (spec.kind !== 'animation')
    return `${spec.label} takes ${spec.kind === 'asset' ? 'an object' : 'a socket'}, not a clip`;
  if (!spec.customizable) {
    return spec.customizableFrom === null
      ? `${spec.label} takes no custom fill`
      : `${spec.label} opens with contract ${spec.customizableFrom}`;
  }
  if (opts.moving === true) return null;
  const holder = app.store.query
    .clipsOfCharacter(character)
    .find((other) => other.deleted === null && other.id !== clip && other.slot === slot);
  return holder === undefined ? null : `'${holder.name}' already fills ${spec.label}: one clip per slot`;
}

/**
 * The Validation rows of a character's target (area `animation`): one per slot issue, with its one-tap fix
 * (`target.fix`). For the OMOBA package profile (`ekza/omoba-humanoid-v2`, C2) they keep the contract's severities, so
 * an error blocks the package export; for any other profile they stay advisory (errors as warnings, warnings as info):
 * nothing a plain export needs fails because of a target (CC-C1-9).
 */
export function targetValidationRows(
  app: Pick<EditorApp, 'store'>,
  character: CharacterId,
  profile: string | null = null,
): RigValidationRow[] {
  const statuses = slotStatuses(app, character);
  if (statuses === null) return [];
  const strict = profile === OMOBA_PACKAGE_PROFILE_ID;
  const rows: RigValidationRow[] = [];
  for (const row of statuses.rows) {
    if (row.status.kind !== 'custom' && row.status.kind !== 'invalid') continue;
    for (const issue of row.status.issues) {
      rows.push({
        code: `contract.${issue.rule}`,
        severity: strict ? issue.severity : issue.severity === 'error' ? 'warning' : 'info',
        area: 'animation',
        message: `${row.label}: ${issue.message}`,
        ids: [row.status.clip],
        fix:
          issue.fix === undefined
            ? null
            : {
                label: issue.fix,
                op: 'target.fix',
                args: {
                  character,
                  slot: row.slot,
                  rule: issue.rule,
                  ...(issue.marker === undefined ? {} : { marker: issue.marker }),
                },
              },
      });
    }
  }
  return rows;
}
