// Static model export (M6A-SPEC §6.2, §5.19, §5.22; B8): `file.exportModel {StaticExportRequest}` writes the export
// roots as a static GLB through io's author writer, lints it for the profile, reads it back and validates it when the
// host has a validator; error lints block the download. The pipeline (`workflows/exportModel.ts`) is a lazy chunk.
import type { ExportArtifact, StaticExportRequest } from '@ekza-studio/io';
import type { EditorApp } from '../../types';
import { blockingLints } from '../../workflows/export';
import type * as ExportModelPipeline from '../../workflows/exportModel';
import { type AnyOperator, defineOperator, fail, OK } from './define';

/** The lazy export pipeline of static models, loaded on the first run (or on intent). */
function loadExportModel(): Promise<typeof ExportModelPipeline> {
  return import('../../workflows/exportModel');
}

/** The pipeline's request check once it has loaded (polls run synchronously). */
let problemOf: ((app: EditorApp, req: unknown) => string | null) | null = null;

const exportModel = defineOperator<'file.exportModel', readonly ExportArtifact[]>({
  id: 'file.exportModel',
  label: 'Export Model',
  description: 'Exports the selected (or every) scene mesh as a static glTF binary.',
  category: 'file',
  scope: 'global',
  workspaces: ['model'],
  extraArgs: ['objects', 'fileName', 'profile', 'colourOutput', 'materialPreset', 'dropTangents', 'validate'],
  poll({ app }, args) {
    if (typeof args !== 'object' || args === null) return fail('expects a static export request');
    // The full check lives with the pipeline; before it has loaded, the request shape is all a poll can see.
    if (problemOf === null) {
      const r = args as Partial<StaticExportRequest>;
      return Array.isArray(r.objects) && typeof r.fileName === 'string'
        ? OK
        : fail('expects { objects, fileName, profile }');
    }
    const problem = problemOf(app, args);
    return problem === null ? OK : fail(problem);
  },
  async prepare({ app }, args) {
    const label = 'Exporting the model…';
    app.session.setState({ busy: { label, progress: null } });
    try {
      const pipeline = await loadExportModel();
      problemOf = pipeline.exportModelProblem;
      return [await pipeline.runExportModel(app, args)];
    } finally {
      if (app.session.getState().busy?.label === label) app.session.setState({ busy: null });
    }
  },
  apply({ app }, _args, artifacts) {
    for (const artifact of artifacts) {
      const errors = blockingLints(artifact);
      if (errors.length > 0) {
        app.services.notify.toast({
          kind: 'error',
          text: `${artifact.fileName} was not saved: ${errors[0]?.message ?? 'export check failed'}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
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

export const EXPORT_MODEL_OPERATORS: readonly AnyOperator[] = [exportModel];
