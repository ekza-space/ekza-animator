// File operators (MVP-SPEC §4.9 `file.*`): new, open (importer dispatch), projects, model / animation / sample
// import, save and export. Everything asynchronous (parsing, hashing, the asset store, baking) happens in `prepare`; `apply`
// writes the document in one transaction (imports) or replaces it (new, open project), and downloads.
import { EkzaError } from '@ekza-animator/anim-core';
import { emptySnapshot } from '@ekza-animator/doc';
import type { ExportArtifact, ExportRequest } from '@ekza-animator/io';
import type { EditorApp, OperatorContext } from '../../types';
import { GLOBAL_SCOPE } from '../../types';
import { blockingLints, requestProblem } from '../../workflows/export';
import type { Progress } from '../../workflows/host';
import {
  animationTargetProblem,
  applyClipImport,
  type ClipImportPlan,
  importTarget,
  prepareGlbAnimationImport,
  prepareVrmaImport,
} from '../../workflows/importAnimation';
import { applyModelImport, type ModelImportPlan, prepareModelImport } from '../../workflows/importModel';
import { extensionOf } from '../../workflows/names';
import {
  loadProject,
  type OpenedProject,
  prepareProjectArchive,
  prepareProjectJson,
  prepareProjectOpen,
  type SaveArtifact,
} from '../../workflows/project';
import { fetchSample, isSampleId, SAMPLES } from '../../workflows/samples';
import { resetDocumentSession } from '../../workflows/session';
import { type AnyOperator, all, defineOperator, fail, forward, isRecord, OK, optionalArgs } from './define';
import { resolveImporter } from './importers';
import { pollEditable } from './polls';

function fileArgsProblem(args: unknown): string | null {
  if (!isRecord(args) || typeof args['name'] !== 'string' || !(args['bytes'] instanceof Uint8Array)) {
    return 'expects { name, bytes }';
  }
  if (args['options'] !== undefined && !isRecord(args['options'])) return 'options must be an object';
  return null;
}

function pollFile(args: unknown) {
  const problem = fileArgsProblem(args);
  return problem === null ? OK : fail(problem);
}

/** Runs `prepare` work with a busy indicator in the session (the shell shows it); `work` may report progress. */
async function busy<T>(app: EditorApp, label: string, work: (progress: Progress) => Promise<T>): Promise<T> {
  app.session.setState({ busy: { label, progress: null } });
  const progress: Progress = (fraction) => {
    if (app.session.getState().busy?.label === label) app.session.setState({ busy: { label, progress: fraction } });
  };
  try {
    return await work(progress);
  } finally {
    if (app.session.getState().busy?.label === label) app.session.setState({ busy: null });
  }
}

/** One warning toast summarizing import warnings. */
function toastWarnings(app: EditorApp, title: string, warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  const shown = warnings.slice(0, 3).join('; ');
  const more = warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '';
  app.services.notify.toast({ kind: 'warning', text: `${title}: ${shown}${more}` });
}

const fileNew = defineOperator({
  id: 'file.new',
  label: 'New Project',
  description: 'Start an empty project (the shell asks before discarding unsaved changes).',
  category: 'file',
  scope: GLOBAL_SCOPE,
  apply({ app }) {
    resetDocumentSession(app);
    app.store.load(emptySnapshot());
    app.history.clear();
    app.session.setState({ dirty: false, dialog: null });
  },
});

const fileOpen = defineOperator<'file.open', void>({
  id: 'file.open',
  label: 'Open…',
  description: 'Open a project, import a model or add animation clips, by file type.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    const problem = fileArgsProblem(args);
    if (problem !== null) return fail(problem);
    const importer = resolveImporter(app.importers, args.name, args.bytes);
    if (importer === null) return fail(`No importer reads '${args.name}'`);
    return app.operators.get(importer.op) === undefined ? fail(`'${importer.op}' is not available`) : OK;
  },
  async prepare(ctx: OperatorContext, args) {
    const importer = resolveImporter(ctx.app.importers, args.name, args.bytes);
    if (importer === null) throw new EkzaError('unsupported', `No importer reads '${args.name}'`);
    await forward(ctx, importer.op, { name: args.name, bytes: args.bytes });
  },
  apply() {},
});

const fileOpenProject = defineOperator<'file.openProject', OpenedProject>({
  id: 'file.openProject',
  label: 'Open Project',
  description: 'Replace the document with an .ekzanim project (never merges).',
  category: 'file',
  scope: GLOBAL_SCOPE,
  poll: (_ctx, args) => pollFile(args),
  prepare: ({ app }, args) => busy(app, `Opening ${args.name}…`, () => prepareProjectOpen(app, args.bytes)),
  apply({ app }, _args, opened) {
    loadProject(app, opened);
    toastWarnings(app, 'Project opened', opened.warnings);
    return { readOnly: app.store.readOnly, migratedFrom: opened.migratedFrom };
  },
});

const fileImportModel = defineOperator<'file.importModel', ModelImportPlan>({
  id: 'file.importModel',
  label: 'Import Model',
  description: 'Import a .glb or .vrm character with its auto-rig and the chosen embedded clips.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Import ${args.name}`,
  poll: ({ app }, args) => all(pollFile(args), pollEditable(app)),
  prepare: ({ app }, args) =>
    busy(app, `Importing ${args.name}…`, (progress) =>
      prepareModelImport(app, { fileName: args.name, bytes: args.bytes, options: args.options, progress }),
    ),
  apply({ app, tx }, _args, plan) {
    if (tx === null) throw new EkzaError('internal', 'file.importModel runs in a transaction');
    const result = applyModelImport(app, tx, plan);
    toastWarnings(app, `Imported ${plan.fileName}`, result.warnings);
    return result;
  },
});

/** Kind of animation file by extension: VRMA (humanoid) or animation-only GLB (any rig, M1-stretch). */
function animationKind(name: string): 'vrma' | 'glb' | null {
  const ext = extensionOf(name);
  return ext === 'vrma' ? 'vrma' : ext === 'glb' ? 'glb' : null;
}

const fileImportAnimation = defineOperator<'file.importAnimation', ClipImportPlan>({
  id: 'file.importAnimation',
  label: 'Import Animation',
  description: 'Add clips from a .vrma (humanoid characters) or an animation-only .glb (matched by node name).',
  category: 'file',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Import ${args.name}`,
  poll({ app }, args) {
    const problem = fileArgsProblem(args);
    if (problem !== null) return fail(problem);
    const kind = animationKind(args.name);
    if (kind === null) return fail('expects a .vrma or an animation-only .glb file');
    const target = importTarget(app.store, args.character, app.session.getState().activeCharacter);
    const targetProblem = animationTargetProblem(app, target, kind === 'vrma');
    return all(pollEditable(app), targetProblem === null ? OK : fail(targetProblem));
  },
  prepare({ app }, args) {
    const target = importTarget(app.store, args.character, app.session.getState().activeCharacter);
    if (target === null) throw new EkzaError('unsupported', 'Load a character first');
    const input = { fileName: args.name, bytes: args.bytes, character: target, options: args.options };
    return busy(app, `Importing ${args.name}…`, () =>
      animationKind(args.name) === 'vrma' ? prepareVrmaImport(app, input) : prepareGlbAnimationImport(app, input),
    );
  },
  apply({ app, tx }, args, plan) {
    if (tx === null) throw new EkzaError('internal', 'file.importAnimation runs in a transaction');
    const result = applyClipImport(app, tx, plan);
    toastWarnings(app, `Imported ${args.name}`, result.warnings);
    return result;
  },
});

const fileLoadSample = defineOperator<'file.loadSample', ModelImportPlan>({
  id: 'file.loadSample',
  label: 'Load Sample',
  description: 'Import a bundled sample character (Seed-san, Polybot or the Quaternius animation library).',
  category: 'file',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Import ${SAMPLES[args.sample]?.file ?? 'sample'}`,
  poll({ app }, args) {
    if (!isRecord(args) || !isSampleId(args['sample']))
      return fail(`expects { sample: ${Object.keys(SAMPLES).join(' | ')} }`);
    if (args['options'] !== undefined && !isRecord(args['options'])) return fail('options must be an object');
    return pollEditable(app);
  },
  prepare({ app }, args) {
    const sample = SAMPLES[args.sample];
    return busy(app, `Loading ${sample.file}…`, async (progress) =>
      prepareModelImport(app, {
        fileName: sample.file,
        bytes: await fetchSample(sample),
        options: args.options,
        known: sample.license,
        defaultClip: sample.defaultClip,
        progress,
      }),
    );
  },
  apply({ app, tx }, _args, plan) {
    if (tx === null) throw new EkzaError('internal', 'file.loadSample runs in a transaction');
    const result = applyModelImport(app, tx, plan);
    toastWarnings(app, `Loaded ${plan.fileName}`, result.warnings);
    return result;
  },
});

function saveName(app: EditorApp, args: unknown): string {
  const options = optionalArgs(args);
  const fileName = options?.['fileName'];
  return typeof fileName === 'string' && fileName.trim() !== '' ? fileName : app.session.getState().projectName;
}

function pollSaveArgs(args: unknown) {
  const options = optionalArgs(args);
  if (options === null) return fail('expects { fileName? }');
  return options['fileName'] === undefined || typeof options['fileName'] === 'string'
    ? OK
    : fail('fileName must be text');
}

function download(app: EditorApp, artifact: SaveArtifact): { readonly fileName: string; readonly bytes: number } {
  app.services.files.download(artifact.fileName, artifact.bytes, artifact.mime);
  return { fileName: artifact.fileName, bytes: artifact.bytes.byteLength };
}

function saveOperator(id: 'file.save' | 'file.saveAs', label: string): AnyOperator {
  return defineOperator<typeof id, SaveArtifact>({
    id,
    label,
    description: 'Download the project as an .ekzanim file (document and source models).',
    category: 'file',
    scope: GLOBAL_SCOPE,
    poll: (_ctx, args) => pollSaveArgs(args),
    prepare: ({ app }, args) => busy(app, 'Saving…', () => prepareProjectArchive(app, saveName(app, args))),
    apply({ app }, _args, artifact) {
      const result = download(app, artifact);
      app.session.setState({ dirty: false });
      return result;
    },
  });
}

const fileSaveJson = defineOperator<'file.saveJson', SaveArtifact>({
  id: 'file.saveJson',
  label: 'Save Debug JSON',
  description: 'Download the document as .ekzanim.json (models are referenced, not included).',
  category: 'file',
  scope: GLOBAL_SCOPE,
  prepare: ({ app }) => prepareProjectJson(app, app.session.getState().projectName),
  apply: ({ app }, _args, artifact) => download(app, artifact),
});

const fileExport = defineOperator<'file.export', readonly ExportArtifact[]>({
  id: 'file.export',
  label: 'Export',
  description: 'Bake clips into the model, as an animation-only GLB or as VRMA files.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    const shape = requestProblem(args);
    if (shape !== null) return fail(shape);
    const exporter = app.exporters.get(args.kind);
    return exporter === undefined ? fail(`Unknown export kind '${args.kind}'`) : exporter.poll(app, args);
  },
  prepare({ app }, args: ExportRequest) {
    const exporter = app.exporters.get(args.kind);
    if (exporter === undefined) throw new EkzaError('unsupported', `Unknown export kind '${args.kind}'`);
    return busy(app, `Exporting ${exporter.label}…`, () => exporter.run(app, args));
  },
  apply({ app }, _args, artifacts) {
    let blocked = 0;
    let warnings = 0;
    for (const artifact of artifacts) {
      const errors = blockingLints(artifact);
      warnings += artifact.lints.filter((lint) => lint.severity === 'warning').length;
      if (errors.length > 0) {
        blocked++;
        app.services.notify.toast({
          kind: 'error',
          text: `${artifact.fileName} was not saved: ${errors[0]?.message ?? 'export check failed'}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
        });
        continue;
      }
      app.services.files.download(artifact.fileName, artifact.bytes, artifact.mime);
    }
    const saved = artifacts.length - blocked;
    if (saved > 0) {
      const names = artifacts.length === 1 ? (artifacts[0]?.fileName ?? '') : `${saved} files`;
      app.services.notify.toast({
        kind: warnings > 0 ? 'warning' : 'success',
        text: `Exported ${names}${warnings > 0 ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`,
      });
    }
    return artifacts;
  },
});

/** Every built-in `file.*` operator. */
export const FILE_OPERATORS: readonly AnyOperator[] = [
  fileNew,
  fileOpen,
  fileOpenProject,
  fileImportModel,
  fileImportAnimation,
  fileLoadSample,
  saveOperator('file.save', 'Save'),
  saveOperator('file.saveAs', 'Save As…'),
  fileSaveJson,
  fileExport,
];
