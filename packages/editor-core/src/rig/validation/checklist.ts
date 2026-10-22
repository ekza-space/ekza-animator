// The MVP setup checklist (M6B-SPEC §0.4.5, §5.21; C7): six derived steps — ① Place markers ② Fit joints ③ Bind skin
// ④ Fix weights ⑤ Try animations ⑥ Export. Steps are never locked; the glyphs only report: `done` when the step's
// check passes, `attention` when it can be worked on and does not pass yet (or passes only in part), `todo` before
// the step before it gives it something to check. Pure (CR-AR-4: the Auto-Rig shell reuses `rigChecklist`).
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp, OperatorId, RigValidationRow } from '../../types';
import { characterMeshes, characterSkeleton } from './inputs';

export type ChecklistGlyph = 'done' | 'attention' | 'todo';
export interface ChecklistStep {
  readonly step: 1 | 2 | 3 | 4 | 5 | 6;
  readonly label: string;
  readonly glyph: ChecklistGlyph;
  /** One line under the label (a hint or why the step is not done). */
  readonly detail: string | null;
  readonly button: { readonly label: string; readonly op: OperatorId; readonly args?: unknown } | null;
}

export interface ChecklistInputs {
  /** The rows of the character under the chosen profile. */
  readonly rows: readonly RigValidationRow[];
  /** A library clip was previewed in this session. */
  readonly previewed: boolean;
}

const hasError = (rows: readonly RigValidationRow[], prefix: string): boolean =>
  rows.some((row) => row.severity === 'error' && row.code.startsWith(prefix));

/** The checklist of a character (null: the empty checklist that starts at ①). */
export function rigChecklist(
  app: Pick<EditorApp, 'store'>,
  character: CharacterId | null,
  inputs: ChecklistInputs,
): readonly ChecklistStep[] {
  const skeleton = character === null ? null : characterSkeleton(app.store, character);
  const meshes = character === null ? [] : characterMeshes(app.store, character);
  const bound = meshes.filter((mesh) => mesh.skin !== null).length;
  const rows = inputs.rows;
  const rigged = skeleton !== null;
  const allBound = rigged && meshes.length > 0 && bound === meshes.length;
  const skinRows = rows.filter((row) => row.code.startsWith('skin.') && row.code !== 'skin.unbound');
  const weightsClean = !skinRows.some((row) => row.severity === 'error' || row.severity === 'warning');
  // "A clip exists": one brought in (Use Clip, an import) or one with curves; an empty new clip and test clips do not count.
  const clips =
    character !== null &&
    app.store
      .list('clips')
      .some(
        (clip) =>
          clip.character === character &&
          (clip.source.kind === 'imported' ||
            clip.source.kind === 'embedded' ||
            (clip.source.kind === 'new' && app.store.list('curves').some((curve) => curve.clip === clip.id))),
      );
  const exportErrors = rows.filter((row) => row.severity === 'error');
  const step = (
    n: ChecklistStep['step'],
    label: string,
    glyph: ChecklistGlyph,
    detail: string | null,
    button: ChecklistStep['button'],
  ): ChecklistStep => ({ step: n, label, glyph, detail, button });
  return [
    step(1, 'Place markers', rigged ? 'done' : 'attention', rigged ? null : 'Quick Rig guesses them from the mesh', {
      label: 'Quick Rig',
      op: 'skel.quickRig.start',
    }),
    step(
      2,
      'Fit joints',
      !rigged ? 'todo' : hasError(rows, 'skel.') || hasError(rows, 'xform.') ? 'attention' : 'done',
      'D + drag moves one joint',
      { label: 'Skeleton mode', op: 'rig.mode', args: { mode: 'skeleton' } },
    ),
    step(
      3,
      'Bind skin',
      !rigged ? 'todo' : allBound ? 'done' : 'attention',
      rigged && !allBound && meshes.length > 0 ? `${bound} of ${meshes.length} meshes bound` : null,
      { label: 'Bind Skin', op: 'skin.bind' },
    ),
    step(
      4,
      'Fix weights',
      bound === 0 ? 'todo' : weightsClean ? 'done' : 'attention',
      bound > 0 && !weightsClean ? `${skinRows.length} weight problem${skinRows.length === 1 ? '' : 's'}` : null,
      { label: 'Paint', op: 'rig.mode', args: { mode: 'skin' } },
    ),
    step(
      5,
      'Try animations',
      inputs.previewed || clips ? 'done' : rigged ? 'attention' : 'todo',
      'Play a clip of the starter pack',
      { label: 'Clip Library', op: 'library.open' },
    ),
    step(
      6,
      'Export',
      !rigged ? 'todo' : exportErrors.length === 0 ? 'done' : 'attention',
      rigged && exportErrors.length > 0
        ? `${exportErrors.length} error${exportErrors.length === 1 ? '' : 's'} block the export`
        : null,
      { label: 'Export Character…', op: 'ui.open', args: { dialog: 'export' } },
    ),
  ];
}

/** `Setup 4/6 · ◐` (the collapsed line, §0.4.5). */
export function checklistSummary(steps: readonly ChecklistStep[], glyph: string): string {
  return `Setup ${steps.filter((step) => step.glyph === 'done').length}/${steps.length} · ${glyph}`;
}
