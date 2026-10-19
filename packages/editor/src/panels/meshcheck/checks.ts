// Mesh Check results as the panel, its overlay and the test API read them (M6A-SPEC §5.25; B10 over B5's
// `checkMesh`): problems grouped by code with their elements, a severity per code and the `mesh.cleanup` fix each
// code offers ("select matching" is every code's default action). Visible elements only (the mesh's hidden set).
import type { MeshId } from '@ekza-animator/doc';
import { type EditorApp, meshKernel } from '@ekza-animator/editor-core';
import type { MeshProblem } from '@ekza-animator/mesh-core';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface CheckRow {
  readonly code: string;
  readonly count: number;
  readonly elements: readonly number[];
  readonly severity: CheckSeverity;
  /** `mesh.cleanup {fix}` value, or null when the code offers no fix. */
  readonly fix: string | null;
  readonly message: string;
}

/** The fixes of §5.25 (`mesh.cleanup` `fix` values). */
export const FIX_OF: Readonly<Record<string, string>> = {
  lamina: 'deleteLamina',
  'zero-length-edge': 'collapse',
  'zero-area-face': 'collapse',
  'inconsistent-winding': 'conform',
  'nonplanar-ngon': 'triangulate',
  'concave-ngon': 'triangulate',
  'stray-vertex': 'dissolve',
  'loose-geometry': 'deleteLoose',
};

/** n-gon codes draw ◇ (amber, warnings); `open-border` is informational; every other code is an error ✕. */
export function severityOf(code: string): CheckSeverity {
  if (code === 'nonplanar-ngon' || code === 'concave-ngon' || code === 'ngon-degenerate') return 'warning';
  if (code === 'open-border') return 'info';
  return 'error';
}

/** The kernel's problems of a mesh's current revision (visible elements), or null when it cannot be checked yet. */
export function meshProblems(app: EditorApp, mesh: MeshId): readonly MeshProblem[] | null {
  const kernel = meshKernel();
  const runtime = app.meshes.get(mesh);
  const data = runtime?.state === 'ready' ? (runtime.mesh ?? runtime.data()) : null;
  if (kernel === null || data === null || data === undefined) return null;
  let hidden: ReturnType<EditorApp['components']['hidden']> | null = null;
  try {
    hidden = app.components.hidden(mesh);
  } catch {
    hidden = null;
  }
  return kernel.checkMesh(data, hidden === null ? undefined : { hidden });
}

/** Problems grouped by code (first appearance order). */
export function checkRows(problems: readonly MeshProblem[]): CheckRow[] {
  const rows = new Map<string, { elements: Set<number>; problems: number; message: string }>();
  for (const problem of problems) {
    let row = rows.get(problem.code);
    if (row === undefined) {
      row = { elements: new Set(), problems: 0, message: problem.message };
      rows.set(problem.code, row);
    }
    row.problems++;
    for (const element of problem.elements ?? []) row.elements.add(element);
  }
  return [...rows].map(([code, row]) => ({
    code,
    count: row.elements.size > 0 ? row.elements.size : row.problems,
    elements: [...row.elements].sort((a, b) => a - b),
    severity: severityOf(code),
    fix: FIX_OF[code] ?? null,
    message: row.message,
  }));
}

/** The mesh the panel checks: the lead hilited mesh, else the lead selected mesh, else the first editable mesh. */
export function checkedMesh(app: EditorApp): MeshId | null {
  const state = app.session.getState();
  const ready = (id: string): boolean => app.meshes.get(id as MeshId)?.state === 'ready';
  const hilited = state.model.componentMode === 'object' ? [] : state.model.hilite.filter(ready);
  const selected = state.selection.objects.filter((id) => id.startsWith('msh_') && ready(id));
  const any = app.meshes
    .list()
    .filter((runtime) => runtime.state === 'ready')
    .map((runtime) => runtime.id);
  return (hilited.at(-1) ?? selected.at(-1) ?? any[0] ?? null) as MeshId | null;
}
