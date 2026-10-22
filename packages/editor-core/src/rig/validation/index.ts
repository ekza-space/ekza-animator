// The Validation service (M6B-SPEC §5.21, §0.4.5; C7): derived rows of a character per export profile (never stored),
// cached by the document version and the character's mesh-runtime versions; the panel's profile (U state,
// `rig.validation.profile`); the tab glyph; the MVP checklist. It lives in the rig-workspace chunk and works without
// the Rig Toolkit or the Validation panel mounted (CR-AR-4): the Export dialog and the Auto-Rig shell read it too.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp, RigValidationRow, RigValidationService, WorkspaceStatus } from '../../types';
import { type ChecklistStep, rigChecklist } from './checklist';
import { characterMeshes, characterSkeleton } from './inputs';
import { DEFAULT_PROFILE, profileRows, type RawRow, rawRows } from './rows';

export { type ChecklistGlyph, type ChecklistStep, checklistSummary, rigChecklist } from './checklist';
export { DEFAULT_PROFILE, profileKind, RIG_PROFILES, SEVERITY } from './rows';
export { type RowSelection, selectValidationRow } from './select';
export { crossLimbParts, type LimbRegion, type PartReach, rigidPartBinds } from './limbs';

/** The rows that make the tab glyph ◐ besides errors (§5.21). */
const ATTENTION_CODES: ReadonlySet<string> = new Set(['skin.review', 'skin.unweighted-vertex', 'skel.tpose']);

export interface RigValidation extends RigValidationService {
  /** The profile the panel shows (`rig.validation.profile`); `rows(c, null)` and `status(c, null)` use it. */
  readonly profile: string;
  setProfile(profile: string | null): boolean;
  /** [Re-run] (§8.12): forgets the cached rows and re-derives them on the next read. */
  rerun(): void;
  /** The MVP checklist of a character (§0.4.5; null: no character, the list starts at ①). */
  checklist(character: CharacterId | null): readonly ChecklistStep[];
  /** ⑤ "a library clip was previewed this session". */
  readonly previewed: boolean;
  markPreviewed(): void;
  /** Profile changes and ⑤ (rows follow the document: re-read them on its changes). */
  subscribe(listener: () => void): Disposer;
}

/** `app.rig.validation` with its C7 surface (the contract types it as `RigValidationService`). */
export function rigValidation(app: Pick<EditorApp, 'rig'>): RigValidation {
  return app.rig.validation as RigValidation;
}

export function createRigValidation(deps: { readonly app: () => EditorApp }): RigValidation {
  let profile = DEFAULT_PROFILE;
  let previewed = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };
  /** Raw rows per character, keyed by the document version and the meshes' runtime versions. */
  const cache = new Map<CharacterId, { readonly key: string; readonly rows: readonly RawRow[] }>();

  const versionKey = (app: EditorApp, character: CharacterId): string => {
    let key = `${app.store.version}`;
    for (const mesh of characterMeshes(app.store, character)) {
      const runtime = app.meshes.get(mesh.id);
      key += `|${runtime?.state ?? '-'}:${runtime?.version ?? -1}`;
    }
    return key;
  };
  const raw = (character: CharacterId): readonly RawRow[] => {
    const app = deps.app();
    const key = versionKey(app, character);
    const hit = cache.get(character);
    if (hit !== undefined && hit.key === key) return hit.rows;
    const rows = rawRows(app, character);
    cache.set(character, { key, rows });
    return rows;
  };
  const rows = (character: CharacterId, chosen: string | null): readonly RigValidationRow[] => {
    const app = deps.app();
    if (app.store.get('characters', character) === undefined) return [];
    const skeleton = characterSkeleton(app.store, character)?.skeleton.id ?? null;
    return profileRows(raw(character), chosen ?? profile, { character, skeleton });
  };

  return {
    get profile() {
      return profile;
    },
    get previewed() {
      return previewed;
    },
    rows,
    status(character, chosen): WorkspaceStatus {
      const app = deps.app();
      if (characterSkeleton(app.store, character) === null) {
        return { glyph: 'todo', reasons: ['No skeleton yet'] };
      }
      const reasons = rows(character, chosen)
        .filter((row) => row.severity === 'error' || ATTENTION_CODES.has(row.code))
        .map((row) => row.message);
      return reasons.length === 0 ? { glyph: 'done', reasons: [] } : { glyph: 'attention', reasons };
    },
    setProfile(next) {
      const value = next ?? DEFAULT_PROFILE;
      if (value === profile) return false;
      profile = value;
      notify();
      return true;
    },
    checklist(character) {
      return rigChecklist(deps.app(), character, {
        rows: character === null ? [] : rows(character, null),
        previewed,
      });
    },
    rerun() {
      cache.clear();
      notify();
    },
    markPreviewed() {
      if (previewed) return;
      previewed = true;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
