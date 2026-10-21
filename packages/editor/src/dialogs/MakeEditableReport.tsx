// The Make editable report (M6A-SPEC §5.21 step 7; B13 over B8's `mesh.makeEditable`): what the last Make editable run
// built — triangles, glTF vertices welded into points, dropped degenerate faces, hard edges, the layers it carried
// over (UVs, colours, skin, morph targets) and its warnings ("Tangents will be refused at export unless you drop
// them"). Shown after the Outliner's Make editable button; Undo reverts the whole step.
import type { MeshId } from '@ekza-studio/doc';
import { type EditorApp, lastMakeEditableReport } from '@ekza-studio/editor-core';
import { Button, Dialog, DialogContent, DialogFooter, TriangleAlert } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { type CheckRow, checkRows, meshProblems } from '../panels/meshcheck/checks';
import { useShell } from '../shell/context';
import { count } from './format';

/**
 * Mesh Check's rows for the editable mesh (the same check as the panel, M6A-INT-51: the dialog said "Degenerate faces:
 * none" — Make editable's dropped triangles — while Mesh Check listed zero-area faces left after the weld); null while
 * the mesh's runtime is not ready.
 */
function useMeshCheck(app: EditorApp, mesh: MeshId | null): readonly CheckRow[] | null {
  // Re-render on every mesh runtime change; the rows are read during render.
  const [, setVersion] = useState(0);
  useEffect(() => app.meshes.subscribe(() => setVersion((v) => v + 1)), [app]);
  if (mesh === null) return null;
  try {
    const problems = meshProblems(app, mesh);
    return problems === null ? null : checkRows(problems).filter((row) => row.code !== 'open-border');
  } catch {
    return null;
  }
}

export function MakeEditableReportDialog(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const last = lastMakeEditableReport(app);
  const record = last === null ? undefined : app.store.get('meshes', last.mesh);
  const close = (): void => void shell.runFromUi('ui.close');
  const report = last?.report ?? null;
  const check = useMeshCheck(app, last?.mesh ?? null);
  const warnings = report === null ? [] : [...report.warnings];
  if (report?.hadTangents === true && !warnings.some((w) => w.includes('Tangent'))) {
    warnings.push('Tangents will be refused at export unless you drop them');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title={record === undefined ? 'Make editable' : `${record.name} is editable`}
        description="Edits are recorded as revisions of this mesh; the original asset stays untouched."
        width="md"
        data-testid="make-editable-report"
      >
        {report === null ? (
          <p className="text-ui text-fg-2">No mesh has been made editable yet.</p>
        ) : (
          <div className="flex flex-col gap-3 text-ui text-fg-2">
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1">
              <dt>Triangles</dt>
              <dd className="ekza-numeric text-fg" data-testid="make-editable-triangles">
                {report.triangles}
              </dd>
              <dt>Points</dt>
              <dd className="ekza-numeric text-fg" data-testid="make-editable-points">
                {report.pointsBefore} glTF vertices → {report.pointsAfter} points
              </dd>
              <dt>Hard edges</dt>
              <dd className="ekza-numeric text-fg">{report.hardEdges}</dd>
              <dt>Dropped triangles</dt>
              <dd className="ekza-numeric text-fg">
                {report.degenerateDropped === 0 ? 'none' : `${count(report.degenerateDropped, 'degenerate triangle')}`}
              </dd>
              <dt>Mesh Check</dt>
              <dd className="text-fg" data-testid="make-editable-check">
                {check === null
                  ? 'checking…'
                  : check.length === 0
                    ? 'clean'
                    : check.map((row) => `${row.code} ${row.count}`).join(', ')}
              </dd>
              <dt>Layers</dt>
              <dd className="text-fg" data-testid="make-editable-layers">
                {report.layers.length === 0 ? 'positions only' : report.layers.join(', ')}
              </dd>
              {report.morphNormals.length === 0 ? null : (
                <>
                  <dt>Morph normals</dt>
                  <dd className="text-fg">{report.morphNormals.join(', ')}</dd>
                </>
              )}
            </dl>
            {warnings.length === 0 ? null : (
              <ul className="flex flex-col gap-1" data-testid="make-editable-warnings">
                {warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1.5">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                    {warning}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="primary" data-testid="make-editable-done" onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
