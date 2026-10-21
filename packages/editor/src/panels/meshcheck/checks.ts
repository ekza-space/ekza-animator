// Mesh Check results as the panel, its overlay and the test API read them (M6A-SPEC §5.25; B10 over B5's
// `checkMesh`): problems grouped by code with their elements, a severity per code and the `mesh.cleanup` fix each
// code offers ("select matching" is every code's default action). Visible elements only (the mesh's hidden set),
// `open-border` only on meshes their template flags closed, `duplicate-slot` from the mesh's palette.
import type { MeshId } from '@ekza-studio/doc';
import { duplicateSlotsOf, type EditorApp, meshCheckOptions, meshKernel } from '@ekza-studio/editor-core';
import type { Domain, MeshProblem } from '@ekza-studio/mesh-core';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface CheckRow {
  readonly code: string;
  /** Distinct elements over every domain (vertex 5 and edge 5 are two), or the problem count without elements. */
  readonly count: number;
  /** The row's domain: the first problem's (the kind "Select" picks in, as `select.mesh.matching`), or null. */
  readonly domain: Domain | null;
  /** The elements in the row's domain, ascending. */
  readonly elements: readonly number[];
  /** The elements per domain, ascending (`loose-geometry` reports loose points and wire edges). */
  readonly byDomain: Readonly<Partial<Record<Domain, readonly number[]>>>;
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

/**
 * The kernel's problems of a mesh's current revision, or null when it cannot be checked yet: visible elements only,
 * `open-border` when its template flags it closed, `duplicate-slot` from its palette (`meshCheckOptions`, the options
 * "select matching" checks with).
 */
export function meshProblems(app: EditorApp, mesh: MeshId): readonly MeshProblem[] | null {
  const kernel = meshKernel();
  const runtime = app.meshes.get(mesh);
  const data = runtime?.state === 'ready' ? (runtime.mesh ?? runtime.data()) : null;
  if (kernel === null || data === null || data === undefined) return null;
  return kernel.checkMesh(data, meshCheckOptions(app, mesh));
}

/**
 * Problems grouped by code (first appearance order). Elements are kept per domain: one code may report several
 * (`loose-geometry`: loose points and wire edges), and an index means a different element in each.
 */
export function checkRows(problems: readonly MeshProblem[]): CheckRow[] {
  interface Group {
    readonly byDomain: Map<Domain | null, Set<number>>;
    domain: Domain | null;
    problems: number;
    readonly message: string;
  }
  const rows = new Map<string, Group>();
  for (const problem of problems) {
    let row = rows.get(problem.code);
    if (row === undefined) {
      row = { byDomain: new Map(), domain: null, problems: 0, message: problem.message };
      rows.set(problem.code, row);
    }
    row.problems++;
    const domain = problem.domain ?? null;
    if (row.domain === null && domain !== null) row.domain = domain;
    const elements = problem.elements ?? [];
    if (elements.length === 0) continue;
    let set = row.byDomain.get(domain);
    if (set === undefined) {
      set = new Set();
      row.byDomain.set(domain, set);
    }
    for (const element of elements) set.add(element);
  }
  const ascending = (set: ReadonlySet<number> | undefined): number[] => [...(set ?? [])].sort((a, b) => a - b);
  return [...rows].map(([code, row]) => {
    // Elements without a domain belong to the row's domain (the one the code's other problems name).
    const loose = row.byDomain.get(null);
    if (loose !== undefined && row.domain !== null) {
      const own = row.byDomain.get(row.domain) ?? new Set<number>();
      for (const element of loose) own.add(element);
      row.byDomain.set(row.domain, own);
      row.byDomain.delete(null);
    }
    let distinct = 0;
    for (const set of row.byDomain.values()) distinct += set.size;
    const byDomain: Partial<Record<Domain, readonly number[]>> = {};
    for (const [domain, set] of row.byDomain) if (domain !== null) byDomain[domain] = ascending(set);
    return {
      code,
      count: distinct > 0 ? distinct : row.problems,
      domain: row.domain,
      elements: ascending(row.byDomain.get(row.domain)),
      byDomain,
      severity: severityOf(code),
      fix: FIX_OF[code] ?? null,
      message: row.message,
    };
  });
}

/**
 * The swatch the `duplicate-slot` row's "Swatch" action makes active (§5.25 "select swatch", `palette.setActive`): of
 * the lowest slot two live swatches of the mesh's palette share, one the reader shadows (it reads the smallest
 * SwatchId, `swatchBySlot`), so the Palette panel shows the duplicate to re-slot or remove. Null without a duplicate.
 */
export function duplicateSwatchOf(app: EditorApp, mesh: MeshId): string | null {
  const record = app.store.get('meshes', mesh);
  if (record === undefined || record.palette === null) return null;
  const slots = duplicateSlotsOf(app, record);
  if (slots.size === 0) return null;
  const slot = Math.min(...slots);
  const read = app.store.query.swatchBySlot(record.palette, slot);
  const shadowed = app.store.query
    .swatchesOfPalette(record.palette)
    .find((swatch) => swatch.deleted === null && swatch.slot === slot && swatch.id !== read?.id);
  return shadowed?.id ?? read?.id ?? null;
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
