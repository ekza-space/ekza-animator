// Built-in exporters (ADR 0008 exporter registry, ADR 0005): bake into the original model (surgeon), animation-only
// GLB, and VRMA (one file per clip). `file.export` dispatches through the registry; extensions add kinds the same way.
import type { ExportRequest } from '@ekza-studio/io';
import type { EditorApp, ExporterDef } from '../../types';
import { type BuiltinExportKind, exportExtension, pollExport, runExport } from '../../workflows/export';

function exporter(id: BuiltinExportKind, label: string): ExporterDef {
  return {
    id,
    label,
    extension: (app: EditorApp, req: ExportRequest) => exportExtension(app, req, id),
    poll: (app: EditorApp, req: ExportRequest) => pollExport(app, req, id),
    run: (app: EditorApp, req: ExportRequest) => runExport(app, req, id),
  };
}

export const BUILTIN_EXPORTERS: readonly ExporterDef[] = [
  exporter('bake-into-model', 'Bake into model'),
  exporter('animation-glb', 'Animation-only GLB'),
  exporter('vrma', 'VRMA (one file per clip)'),
];
