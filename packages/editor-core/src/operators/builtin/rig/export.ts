// C10 (character writer; M6B-SPEC §5.22, §6.1, §6.4, §0.6): the export operators of model-sourced characters, in
// the lazy rig-workspace chunk.
//
// - `char.setVrmMeta {character, patch}` (VRM Meta…; one undo step): merges the patch into `CharacterRecord.vrm`
//   (created with the schema defaults and the character's name when null). A licence preset in the patch sets its
//   fields first and the patch's own fields win; editing a preset field away from its value makes the licence
//   'custom' (`patchVrmMeta`). Field values are repaired to the schema's (`repairVrmMeta`): a bad enum is refused.
// - `char.renderThumbnail {character}` (Render Thumbnail; one undo step): renders the character at the bind pose
//   (io's deterministic software renderer, 1024 × 1024 PNG), stores it as a thumbnail asset by hash and sets
//   `vrm.thumbnail`; returns the asset id.
// - `file.exportCharacter {CharacterExportRequest}` (Export Character…; no undo, no document change): the pipeline of
//   `workflows/exportCharacter.ts`; error lints (the profile's Validation rows, the VRM meta rows, the byte lints,
//   glTF-Validator, the read-back) block the download; returns the artifact.
import { EkzaError } from '@ekza-studio/anim-core';
import {
  type AssetRecord,
  type CharacterId,
  type CharacterVrmMeta,
  makeVrmMeta,
  repairVrmMeta,
} from '@ekza-studio/doc';
import { type ExportArtifact, patchVrmMeta } from '@ekza-studio/io';
import type { EditorApp, PollResult } from '../../../types';
import { blockingLints } from '../../../workflows/export';
import {
  characterOf,
  characterRequestProblem,
  isModelCharacter,
  renderThumbnailAsset,
  runExportCharacter,
} from '../../../workflows/exportCharacter';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK, optionalArgs } from '../define';

const NOT_MODEL = 'VRM meta and thumbnails belong to characters made from models (imported avatars keep their own)';

function pollCharacter(app: EditorApp, raw: unknown): PollResult {
  const args = optionalArgs(raw);
  if (args === null) return fail('expects { character }');
  const id = characterOf(app, args['character']);
  if (id === null) return fail('Make a character from your model first (Rig & Skin › Quick Rig)');
  const record = app.store.get('characters', id);
  if (record === undefined) return fail(`Character ${id} does not exist`);
  return isModelCharacter(record) ? OK : fail(NOT_MODEL);
}

/** The repaired next meta, or why the patch is refused. */
export function nextVrmMeta(current: CharacterVrmMeta, name: string, patch: unknown): CharacterVrmMeta | string {
  if (!isRecord(patch)) return 'expects a patch of VRM meta fields';
  const known = new Set(Object.keys(makeVrmMeta('')));
  const unknown = Object.keys(patch).filter((key) => !known.has(key));
  if (unknown.length > 0) return `Unknown VRM meta field ${unknown.join(', ')}`;
  const next = patchVrmMeta(current, patch);
  const repaired = repairVrmMeta(next as unknown as Readonly<Record<string, unknown>>, name);
  if (repaired !== (next as unknown)) {
    const bad = Object.keys(patch).find(
      (key) =>
        JSON.stringify((repaired as Record<string, unknown>)[key]) !==
        JSON.stringify((next as unknown as Record<string, unknown>)[key]),
    );
    return `Invalid value for ${bad ?? 'a VRM meta field'}`;
  }
  return next;
}

const setVrmMeta = defineOperator<'char.setVrmMeta'>({
  id: 'char.setVrmMeta',
  label: 'VRM Meta…',
  description: "Sets the VRM meta of a character's exports: name, authors, licence, contact and references.",
  category: 'char',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['character', 'patch'],
  undoLabel: () => 'VRM Meta',
  poll({ app }, raw) {
    const base = pollCharacter(app, raw);
    if (base !== true) return base;
    const args = optionalArgs(raw) ?? {};
    if (args['patch'] === undefined) return OK; // opens the VRM Meta dialog
    const id = characterOf(app, args['character']) as CharacterId;
    const record = app.store.get('characters', id);
    if (record === undefined) return fail('The character does not exist');
    const next = nextVrmMeta(record.vrm ?? makeVrmMeta(record.name), record.name, args['patch']);
    return typeof next === 'string' ? fail(next) : OK;
  },
  async prepare(ctx, raw) {
    // Without a patch (the menu item) the VRM Meta dialog opens; the run writes nothing.
    if ((optionalArgs(raw) ?? {})['patch'] !== undefined) return;
    if (ctx.app.operators.get('ui.open') === undefined) ctx.app.session.setState({ dialog: 'vrmMeta' });
    else await forward(ctx, 'ui.open', { dialog: 'vrmMeta' });
  },
  apply({ app, tx }, raw) {
    const args = optionalArgs(raw) ?? {};
    if (args['patch'] === undefined) return;
    if (tx === null) throw new EkzaError('internal', 'char.setVrmMeta runs in a transaction');
    const id = characterOf(app, args['character']) as CharacterId;
    const record = tx.get('characters', id);
    if (record === undefined) throw new EkzaError('unsupported', 'The character does not exist');
    const next = nextVrmMeta(record.vrm ?? makeVrmMeta(record.name), record.name, args['patch']);
    if (typeof next === 'string') throw new EkzaError('invalid-input', next);
    tx.patch('characters', id, { vrm: next });
    // AR-D10-8: a project named after its character (an Auto-Rig import) follows a new VRM name, so Studio's title
    // and Auto-Rig's header agree after a rename
    const before = record.vrm?.name || record.name;
    const project = tx.get('project', 'project');
    if (next.name !== before && next.name.trim() !== '' && project !== undefined && project.name === before) {
      tx.patch('project', 'project', { name: next.name });
      if (app.session.getState().projectName !== next.name) app.session.setState({ projectName: next.name });
    }
  },
});

const renderThumbnail = defineOperator<'char.renderThumbnail', AssetRecord>({
  id: 'char.renderThumbnail',
  label: 'Render Thumbnail',
  description: 'Renders the character at the bind pose as its 1024 × 1024 VRM thumbnail.',
  category: 'char',
  scope: 'rig',
  workspaces: ['rig'],
  flags: { undo: true },
  extraArgs: ['character'],
  undoLabel: () => 'Render Thumbnail',
  poll: ({ app }, raw) => pollCharacter(app, raw),
  async prepare({ app }, raw) {
    const id = characterOf(app, (optionalArgs(raw) ?? {})['character']);
    if (id === null) throw new EkzaError('unsupported', 'Make a character from your model first');
    return renderThumbnailAsset(app, id);
  },
  apply({ app, tx }, raw, asset) {
    if (tx === null) throw new EkzaError('internal', 'char.renderThumbnail runs in a transaction');
    const id = characterOf(app, (optionalArgs(raw) ?? {})['character']) as CharacterId;
    const record = tx.get('characters', id);
    if (record === undefined) throw new EkzaError('unsupported', 'The character does not exist');
    if (tx.get('assets', asset.id) === undefined) tx.put('assets', asset);
    tx.patch('characters', id, { vrm: { ...(record.vrm ?? makeVrmMeta(record.name)), thumbnail: asset.id } });
    return { asset: asset.id };
  },
});

/** The pipeline's full request check once it is resident (polls are synchronous). */
const exportCharacter = defineOperator<'file.exportCharacter', readonly ExportArtifact[]>({
  id: 'file.exportCharacter',
  label: 'Export Character…',
  description: 'Exports a character made from your model as a VRM 1.0 avatar (Ekza Space and OMOBA) or a plain GLB.',
  category: 'file',
  scope: 'global',
  workspaces: ['rig', 'animate', 'model'],
  extraArgs: [
    'character',
    'fileName',
    'format',
    'profile',
    'clips',
    'includeProps',
    'material',
    'thumbnail',
    'validate',
  ],
  poll({ app }, raw) {
    const problem = characterRequestProblem(app, raw);
    return problem === null ? OK : fail(problem);
  },
  async prepare({ app }, raw) {
    const label = 'Exporting the character…';
    app.session.setState({ busy: { label, progress: null } });
    try {
      return [await runExportCharacter(app, raw)];
    } finally {
      if (app.session.getState().busy?.label === label) app.session.setState({ busy: null });
    }
  },
  apply({ app }, _raw, artifacts) {
    for (const artifact of artifacts) {
      const errors = blockingLints(artifact);
      if (errors.length > 0) {
        app.services.notify.toast({
          kind: 'error',
          text: `${artifact.fileName} was not saved: ${errors[0]?.message ?? 'export check failed'}${
            errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
          }`,
        });
        continue;
      }
      app.services.files.download(artifact.fileName, artifact.bytes, artifact.mime);
      const warnings = artifact.lints.filter((lint) => lint.severity === 'warning').length;
      app.services.notify.toast({
        kind: warnings > 0 ? 'warning' : 'success',
        text: `Exported ${artifact.fileName}${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`,
      });
    }
    return artifacts;
  },
});

export const CHARACTER_EXPORT_OPERATORS: readonly AnyOperator[] = [setVrmMeta, renderThumbnail, exportCharacter];
