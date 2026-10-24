// The OMOBA hero package of a character (CHARACTER-CONTRACT-SPEC §4.1, §8.9, §8.10, Appendix C; GAME-PROTOCOL-SPEC §5.2;
// C2): which clips go in and how the slot map names them. The package holds one animation per **custom** clip — the
// clip that holds a slot of the target's character offer, in the offer's order, named by that (primary) slot — and the
// `ekza_package_v1` manifest lists every customizable slot of the offer once: `custom` with the animation index and the
// marker seconds the slot declares (an aliased slot, *Same clip as…*, names the animation of the slot it reuses), else
// `default` (the game plays its own; defaults are never shipped). Clips the game will not use (`extras`) stay out.
// After writing, the TypeScript rule set runs on the bytes (`checkCharacterPackage`, the same rules as OMOBA's
// passport) and its issues become the export's `package.<rule>` lints (the document checks are the `contract.<rule>`
// Validation rows): an error blocks the download.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipRecord } from '@ekza-studio/doc';
import {
  type CharacterPackageFill,
  type ContractModel,
  characterOffer,
  characterPackageManifest,
  checkCharacterPackage,
  clipFramesToSeconds,
  contractTarget,
  type EkzaClipMetaV1,
  type LintIssue,
  type PackageManifest,
  type PackageReport,
} from '@ekza-studio/io';
import type { EditorApp } from '../../types';
import { CONTACT_MARKER, namedMarkers } from './markers';
import { bindingOf, slotStatuses } from './service';
import type { SlotStatuses } from './status';
import type { TargetRecord } from './table';

/** The tool name a package's provenance carries. */
export const PACKAGE_TOOL = 'ekza-studio';

export interface PackagePlan {
  readonly character: CharacterId;
  readonly model: ContractModel;
  readonly target: TargetRecord;
  readonly statuses: SlotStatuses;
  /** The clip of each animation, in animation-index order (each named by its primary slot). */
  readonly clips: readonly ClipRecord[];
  /** Every custom slot: its animation index and marker seconds. */
  readonly fills: ReadonlyMap<string, CharacterPackageFill>;
}

/** Marker seconds of a clip (frames from its range start, the metadata's formula), every marker set. */
export function clipMarkerSeconds(app: Pick<EditorApp, 'store'>, clip: ClipRecord): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  const toSecs = (frame: number) => clipFramesToSeconds(frame - clip.range.start, clip.fps);
  for (const [name, frame] of Object.entries(namedMarkers(app.store, clip.id))) out[name] = toSecs(frame);
  if (clip.contact !== null) out[CONTACT_MARKER] = toSecs(clip.contact);
  return out;
}

/** The package plan of a character's target, or an `EkzaError('unsupported')` saying why there is none. */
export function packagePlan(app: Pick<EditorApp, 'store'>, character: CharacterId): PackagePlan {
  const binding = bindingOf(app, character);
  if (binding === null) throw new EkzaError('unsupported', 'Set what the character is for first (Windows › Target)');
  if (binding.model === null) throw new EkzaError('unsupported', binding.error);
  const statuses = slotStatuses(app, character);
  const view = contractTarget(binding.model, binding.target.target);
  const offer = view === undefined ? undefined : characterOffer(view);
  if (statuses === null || offer === undefined) {
    throw new EkzaError('unsupported', `${view?.name ?? binding.target.target} takes no character package`);
  }
  const byId = new Map(app.store.query.clipsOfCharacter(character).map((clip) => [clip.id, clip]));
  const clips: ClipRecord[] = [];
  const fills = new Map<string, CharacterPackageFill>();
  const rows = new Map(statuses.rows.map((row) => [row.slot, row]));
  for (const slot of offer.slots) {
    const row = rows.get(slot);
    const spec = binding.model.slots[slot];
    if (row === undefined || spec?.animation === null || spec === undefined) continue;
    if (row.status.kind !== 'custom' && row.status.kind !== 'invalid') continue;
    const clip = byId.get(row.status.clip);
    if (clip === undefined) continue;
    let index = clips.indexOf(clip);
    if (index < 0) {
      index = clips.length;
      clips.push(clip);
    }
    const seconds = clipMarkerSeconds(app, clip);
    const markers: Record<string, number> = {};
    for (const name of Object.keys(spec.animation.markers)) {
      const at = seconds[name];
      if (at !== undefined) markers[name] = at;
    }
    fills.set(slot, { animation: index, markers });
  }
  return { character, model: binding.model, target: binding.target, statuses, clips, fills };
}

/** The manifest of a plan (`ekza.package.v1`). */
export function packageManifestOf(plan: PackagePlan, toolVersion: string): PackageManifest {
  return characterPackageManifest({
    model: plan.model,
    target: plan.target.target,
    fills: plan.fills,
    tool: PACKAGE_TOOL,
    toolVersion,
  });
}

/** The extra clip metadata of a package clip (§8.14): its label and its named markers. */
export function packageClipMeta(app: Pick<EditorApp, 'store'>, clip: ClipRecord, meta: EkzaClipMetaV1): EkzaClipMetaV1 {
  const { [CONTACT_MARKER]: _contact, ...markers } = clipMarkerSeconds(app, clip);
  return { ...meta, label: clip.name, ...(Object.keys(markers).length === 0 ? {} : { markers }) };
}

/** The contract checks of the written package (read back): one lint per issue, `package.<rule>`. */
export function packageLints(bytes: Uint8Array, plan: PackagePlan): { lints: LintIssue[]; report: PackageReport } {
  const report = checkCharacterPackage(bytes, {
    contract: (revision) => (revision === plan.model.revision ? plan.model : undefined),
  });
  const label = (slot: string) => plan.model.slots[slot]?.label ?? slot;
  const lints: LintIssue[] = report.issues.map((issue) => ({
    code: `package.${issue.rule}`,
    severity: issue.severity,
    message: `Package: ${issue.message}`,
    ...(issue.path === null ? {} : { pointer: issue.path }),
  }));
  for (const [slot, entry] of Object.entries(report.slots)) {
    for (const issue of entry.issues) {
      lints.push({
        code: `package.${issue.rule}`,
        severity: issue.severity,
        message: `${label(slot)}: ${issue.message}`,
        ...(issue.path === null ? {} : { pointer: issue.path }),
      });
    }
  }
  return { lints, report };
}
