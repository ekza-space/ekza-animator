// Make editable (M6A-SPEC §6.2, §5.21; B8 owns the operator, B13 the Outliner button and the report dialog).
//
// `mesh.makeEditable {character, meshIndex}` creates the record of one of a character's glTF meshes lazily, in its
// own transaction, with the derived id `derivedId('mesh', 'asset', [characterId], '', meshIndex)` (so a re-run or an
// M3 peer never duplicates it), `owner: {character}`, `source: {asset, mesh}`, the imported skin, the asset's material
// slots and its first revision as `data`. Importing or animating a character writes no mesh record (rule 10).
// `prepare` runs the lazy half (`workflows/exportModel.ts`: the io/mesh entry decodes, welds and gates, the record is
// built); a refusal fails the run with its reason and writes nothing. The poll checks the licence up front.
import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, MeshId } from '@ekza-animator/doc';
import { type MakeEditableReport, readVrmLicense } from '@ekza-animator/io';
import { isAssetCharacter } from '../../characters/registry';
import type { EditorApp, PollResult } from '../../types';
import type { MakeEditablePrepared } from '../../workflows/exportModel';
import { assetMeshId } from '../../workflows/meshDisplay';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';
import { pollEditable } from './polls';

/** The last Make editable report per app (B13's report dialog reads it). */
const reports = new WeakMap<EditorApp, { readonly mesh: MeshId; readonly report: MakeEditableReport }>();

/** The report of the app's last successful Make editable run, or null. */
export function lastMakeEditableReport(
  app: EditorApp,
): { readonly mesh: MeshId; readonly report: MakeEditableReport } | null {
  return reports.get(app) ?? null;
}

const BUSY = 'Making the mesh editable…';

function poll(app: EditorApp, args: unknown): PollResult {
  if (!isRecord(args)) return fail('expects { character, meshIndex }');
  if (typeof args['character'] !== 'string') return fail('expects a character');
  const meshIndex = args['meshIndex'];
  if (typeof meshIndex !== 'number' || !Number.isInteger(meshIndex) || meshIndex < 0) {
    return fail('expects a glTF mesh index ≥ 0');
  }
  const editable = pollEditable(app);
  if (editable !== true) return editable;
  const id = args['character'] as CharacterId;
  const character = app.store.get('characters', id);
  if (character === undefined) return fail('The character does not exist');
  if (!isAssetCharacter(character)) return fail('Only imported characters have glTF meshes to make editable');
  const runtime = app.characters.get(id);
  if (runtime === undefined) return fail(`${character.name} is still loading`);
  const meshes = runtime.container.json['meshes'];
  if (!Array.isArray(meshes) || meshIndex >= meshes.length)
    return fail(`${character.name} has no glTF mesh ${meshIndex}`);
  if (app.store.get('meshes', assetMeshId(id, meshIndex)) !== undefined) return fail('This mesh is already editable');
  // The licence gate (Q-SKIN-2), with the lazy `editLicence` rule: VRM meta forbidding modification.
  let modification: string | null = null;
  try {
    modification = readVrmLicense(runtime.container)?.modification ?? null;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  return modification === 'prohibited'
    ? fail(
        "This avatar's licence does not allow modification; its meshes stay read-only (animation-only exports are still allowed)",
      )
    : OK;
}

const makeEditable = defineOperator<'mesh.makeEditable', MakeEditablePrepared>({
  id: 'mesh.makeEditable',
  label: 'Make Editable',
  description: "Turns a character's glTF mesh into an editable mesh record.",
  category: 'mesh',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true },
  extraArgs: ['character', 'meshIndex'],
  undoLabel: () => 'Make Editable',
  poll: ({ app }, args) => poll(app, args),
  async prepare({ app }, args) {
    app.session.setState({ busy: { label: BUSY, progress: null } });
    try {
      const lazy = await import('../../workflows/exportModel');
      return await lazy.prepareMakeEditable(app, args);
    } finally {
      if (app.session.getState().busy?.label === BUSY) app.session.setState({ busy: null });
    }
  },
  apply({ app, tx }, _args, prepared) {
    if (tx === null) throw new EkzaError('internal', 'mesh.makeEditable runs in a transaction');
    const { record } = prepared;
    if (tx.get('meshes', record.id) !== undefined) throw new EkzaError('unsupported', 'This mesh is already editable');
    tx.put('meshes', record);
    app.meshes.writeData(tx, record.id, prepared.data);
    reports.set(app, { mesh: record.id, report: prepared.report });
    return { mesh: record.id, report: prepared.report };
  },
});

export const MAKE_EDITABLE_OPERATORS: readonly AnyOperator[] = [makeEditable];
