// Readiness (STUDIO-TOUCH-SPEC §7.2, ST-36; T6b): one pure function over the EditorApp that returns one list of problem
// rows for the current destination — never stored, so undo, reloads and edits made in Studio Pro keep it right. Every
// surface reads that list: the Path's stage glyphs show each stage's rows, the status pill shows the total (never a
// per-stage filter, never "All good" while any row exists), the Health sheet lists them, Share's card (T11) shows the
// same rows and count, and the budget ring appears only when the destination has a triangle budget. It never forces a
// chunk to load: a stage whose kernel chunk is not there yet shows `·`.
//
// Sources (§7.2): Make — Mesh Check (the kernel's `checkMesh` with the panel's options) and the triangle budget; Paint —
// colours assigned; Rig — the Validation rows of the active character under the destination's profile (which carry
// `rigChecklist`'s rows) and, for destinations that need one, a skeleton; Animate — the clip slots the destination's
// profile requires.
import type { MeshId } from '@ekza-studio/doc';
import {
  type EditorApp,
  meshBudget,
  meshCheckOptions,
  meshKernel,
  type OperatorId,
  type RigValidationRow,
} from '@ekza-studio/editor-core';
import type { Stage } from '../manifest/types';
import { type Destination, type DestinationId, destinationOf } from './destinations';

export type ReadinessStage = Stage | 'share';

export interface ReadinessAction {
  readonly label: string;
  readonly op: OperatorId;
  readonly args?: unknown;
}

/** One problem for the destination (a Health row, a health dot, a Share card line). */
export interface ReadinessRow {
  /** Stable across renders: stage, code and subject. */
  readonly id: string;
  readonly stage: ReadinessStage;
  readonly code: string;
  readonly severity: 'error' | 'warning';
  /** Plain words: what is wrong. */
  readonly text: string;
  /** Plain words: why it matters here (the Why? petal). */
  readonly why: string;
  /** The records it is about (meshes, joints, clips) for *Show me* and the health dot. */
  readonly ids: readonly string[];
  /** One operator that fixes it in place, or null (a hands-on fix: *Go fix ▸* jumps to the stage). */
  readonly fix: ReadinessAction | null;
  /** *Show me*: selects and frames the offending thing. */
  readonly show: ReadinessAction | null;
}

/** The glyph of a stage node (§7.2 legend): ○ untouched, ◐ in progress, ● ready, ⚠n to fix, · not checked yet. */
export type StageGlyph = 'untouched' | 'progress' | 'ready' | 'warn' | 'unchecked';

export interface StageReadiness {
  readonly glyph: StageGlyph;
  /** Rows of this stage (the n of ⚠n). */
  readonly count: number;
}

export interface Readiness {
  readonly destination: Destination;
  readonly rows: readonly ReadinessRow[];
  readonly stages: Readonly<Record<Stage, StageReadiness>>;
  /** The status pill's number: every row, whatever the stage (§7.2). */
  readonly total: number;
  /** The budget ring: triangles against the destination's budget; null when there is no budget. */
  readonly budget: { readonly tris: number; readonly limit: number } | null;
}

/** The glyph's text, with shape and count so colour is never the only cue (§18). */
export const GLYPH_TEXT: Readonly<Record<StageGlyph, string>> = {
  untouched: '○',
  progress: '◐',
  ready: '●',
  warn: '⚠',
  unchecked: '·',
};

export const GLYPH_MEANING: Readonly<Record<StageGlyph, string>> = {
  untouched: 'untouched',
  progress: 'in progress',
  ready: 'ready for where it is going',
  warn: 'things to fix for where it is going',
  unchecked: 'not checked yet',
};

/** Mesh Check codes in plain words (§17: no jargon at the first layers). */
const MESH_WORDS: Readonly<Record<string, string>> = {
  lamina: 'Faces lying on top of each other',
  'zero-length-edge': 'Edges with no length',
  'zero-area-face': 'Faces with no area',
  'inconsistent-winding': 'Faces pointing the wrong way',
  'nonplanar-ngon': 'Bent many-sided faces',
  'concave-ngon': 'Dented many-sided faces',
  'ngon-degenerate': 'Broken many-sided faces',
  'stray-vertex': 'Stray points',
  'loose-geometry': 'Loose points or edges',
  'non-manifold': 'Edges shared by too many faces',
  'open-border': 'Holes in a closed part',
  'duplicate-slot': 'Two colours share a slot',
};

/** `mesh.cleanup {fix}` per code (the Mesh Check panel's fixes, M6A-SPEC §5.25). */
const MESH_FIX: Readonly<Record<string, string>> = {
  lamina: 'deleteLamina',
  'zero-length-edge': 'collapse',
  'zero-area-face': 'collapse',
  'inconsistent-winding': 'conform',
  'nonplanar-ngon': 'triangulate',
  'concave-ngon': 'triangulate',
  'stray-vertex': 'dissolve',
  'loose-geometry': 'deleteLoose',
};

const severityOfCode = (code: string): 'error' | 'warning' | 'info' =>
  code === 'nonplanar-ngon' || code === 'concave-ngon' || code === 'ngon-degenerate'
    ? 'warning'
    : code === 'open-border'
      ? 'info'
      : 'error';

interface MeshLike {
  readonly id: MeshId;
  readonly name: string;
  readonly deleted: unknown;
  readonly data: unknown;
  readonly palette: unknown;
}

function editableMeshes(app: EditorApp): readonly MeshLike[] {
  return (app.store.list('meshes') as unknown as readonly MeshLike[]).filter(
    (mesh) => mesh.deleted === null && mesh.data !== null,
  );
}

function makeRows(app: EditorApp, destination: Destination): { rows: ReadinessRow[]; checked: boolean } {
  const kernel = meshKernel();
  const rows: ReadinessRow[] = [];
  let checked = true;
  for (const mesh of editableMeshes(app)) {
    const runtime = app.meshes.get(mesh.id);
    const data = runtime?.state === 'ready' ? (runtime.mesh ?? runtime.data()) : null;
    if (kernel === null || data === null || data === undefined) {
      checked = false;
      continue;
    }
    let problems: readonly { readonly code: string }[] = [];
    try {
      problems = kernel.checkMesh(data, meshCheckOptions(app, mesh.id));
    } catch {
      checked = false;
      continue;
    }
    const codes = new Map<string, number>();
    for (const problem of problems) codes.set(problem.code, (codes.get(problem.code) ?? 0) + 1);
    for (const [code, count] of codes) {
      const severity = severityOfCode(code);
      if (severity === 'info') continue;
      // Just exploring (ST-4): Mesh Check errors only.
      if (destination.id === 'exploring' && severity !== 'error') continue;
      const fix = MESH_FIX[code];
      rows.push({
        id: `make:${code}:${mesh.id}`,
        stage: 'make',
        code,
        severity,
        text: `${mesh.name}: ${MESH_WORDS[code] ?? code}${count > 1 ? ` (${count})` : ''}`,
        why: 'Mesh Check: games and other tools may show these faces wrong or refuse the file.',
        ids: [mesh.id],
        fix:
          fix === undefined
            ? null
            : { label: 'Fix', op: 'mesh.cleanup', args: { meshes: [mesh.id], fix, selectOnly: false } },
        show: { label: 'Show me', op: 'select.mesh.matching', args: { mesh: mesh.id, code } },
      });
    }
  }
  return { rows, checked };
}

/** The triangle budget of the destination, from the meshes' budgets (Prop for OMOBA defaults to a hand-held prop). */
function budgetOf(app: EditorApp, destination: Destination): Readiness['budget'] {
  if (destination.id === 'exploring') return null;
  let tris = 0;
  let limit: number | null = destination.triangleBudget;
  for (const mesh of editableMeshes(app)) {
    const runtime = app.meshes.get(mesh.id);
    if (runtime?.state === 'ready') tris += runtime.triangulation().triFace.length;
    const own = meshBudget(app, mesh as never);
    if (own !== null) limit = Math.max(limit ?? 0, own.tris);
  }
  return limit === null ? null : { tris, limit };
}

interface CharacterLike {
  readonly id: string;
  readonly name: string;
  readonly deleted: unknown;
  readonly skeleton: string | null;
}

function liveCharacters(app: EditorApp): readonly CharacterLike[] {
  return (app.store.list('characters') as unknown as readonly CharacterLike[]).filter((c) => c.deleted === null);
}

function activeCharacter(app: EditorApp): CharacterLike | null {
  const id = app.session.getState().activeCharacter;
  return liveCharacters(app).find((c) => c.id === id) ?? liveCharacters(app)[0] ?? null;
}

function rigRows(app: EditorApp, destination: Destination): { rows: ReadinessRow[]; checked: boolean } {
  const rows: ReadinessRow[] = [];
  const character = activeCharacter(app);
  if (destination.id === 'exploring') return { rows, checked: true };
  if (character === null) {
    if (destination.needsRig && editableMeshes(app).length > 0) {
      rows.push({
        id: 'rig:no-skeleton',
        stage: 'rig',
        code: 'no-skeleton',
        severity: 'error',
        text: 'No skeleton yet',
        why: `${destination.name} needs a rigged character.`,
        ids: [],
        fix: { label: 'Rig it for me', op: 'skel.quickRig.start' },
        show: null,
      });
    }
    return { rows, checked: true };
  }
  if (!app.rig.loaded) return { rows, checked: false };
  const profile = destination.profile === 'source' ? null : destination.profile;
  let validation: readonly RigValidationRow[] = [];
  try {
    validation = app.rig.validation.rows(character.id as never, profile);
  } catch {
    return { rows, checked: false };
  }
  for (const row of validation) {
    if (row.severity !== 'error' && row.severity !== 'warning') continue;
    rows.push({
      id: `rig:${row.code}:${row.ids.join(',')}`,
      stage: row.area === 'export' ? 'share' : row.area === 'animation' ? 'animate' : 'rig',
      code: row.code,
      severity: row.severity,
      text: row.message,
      why: `A check of ${destination.name}.`,
      ids: row.ids,
      fix: row.fix === null ? null : { label: row.fix.label, op: row.fix.op, args: row.fix.args },
      show: null,
    });
  }
  return { rows, checked: true };
}

function animateRows(app: EditorApp, destination: Destination): ReadinessRow[] {
  const character = activeCharacter(app);
  if (character === null || destination.profile === null || destination.profile === 'source') return [];
  const required = app.exportProfiles.get(destination.profile)?.requiredClips ?? [];
  if (required.length === 0) return [];
  const slots = new Set(
    (app.store.list('clips') as unknown as readonly { character: string; slot: string | null; deleted: unknown }[])
      .filter((clip) => clip.deleted === null && clip.character === character.id && clip.slot !== null)
      .map((clip) => clip.slot as string),
  );
  return required
    .filter((slot) => !slots.has(slot))
    .map(
      (slot): ReadinessRow => ({
        id: `animate:slot:${slot}`,
        stage: 'animate',
        code: 'missing-slot',
        severity: 'error',
        text: `No ${slot} animation`,
        why: `${destination.name} plays a ${slot} animation.`,
        ids: [character.id],
        fix: null,
        show: null,
      }),
    );
}

function glyphOf(rows: number, touched: boolean, ready: boolean, checked: boolean): StageGlyph {
  if (!checked) return 'unchecked';
  if (rows > 0) return 'warn';
  if (!touched) return 'untouched';
  return ready ? 'ready' : 'progress';
}

/** The readiness of the document for a destination (pure; read at human speed). */
export function readiness(app: EditorApp, destinationId: DestinationId | string = 'exploring'): Readiness {
  const destination = destinationOf(destinationId);
  const make = makeRows(app, destination);
  const rig = rigRows(app, destination);
  const animate = animateRows(app, destination);
  const rows = [...make.rows, ...rig.rows, ...animate];
  const count = (stage: ReadinessStage): number => rows.filter((row) => row.stage === stage).length;
  const meshes = editableMeshes(app);
  const character = activeCharacter(app);
  const painted = meshes.some((mesh) => mesh.palette !== null);
  const clips = app.store.list('clips').length;
  const keys = app.store.list('keys').length;
  const stages: Record<Stage, StageReadiness> = {
    make: {
      glyph: glyphOf(
        count('make'),
        meshes.length > 0,
        destination.id !== 'exploring' || meshes.length > 0,
        make.checked,
      ),
      count: count('make'),
    },
    paint: { glyph: glyphOf(0, painted, painted, true), count: 0 },
    rig: {
      glyph: glyphOf(count('rig'), character !== null, character?.skeleton !== null, rig.checked),
      count: count('rig'),
    },
    animate: {
      glyph: glyphOf(count('animate'), clips > 0 || keys > 0, keys > 0 && destination.id !== 'exploring', true),
      count: count('animate'),
    },
  };
  return { destination, rows, stages, total: rows.length, budget: budgetOf(app, destination) };
}

/** The status pill's words: never "All good" while any row exists (§7.2). */
export function statusText(r: Readiness): string | null {
  if (r.total > 0) return `${r.total} to fix`;
  return null;
}
