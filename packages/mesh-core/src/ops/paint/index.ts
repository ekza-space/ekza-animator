// Kernel ops of `ops/paint/` (M6A-SPEC §5.19, §6.1; owner B13): the per-face palette slot is the colour truth (the
// face layer `paint`, u16 swatch slot; faces without the layer read slot 0, its default).
//
// - `mesh.paint {slot, faces?}` (Assign Colour; the Paint Colour tool's click and drag strokes): writes `slot` on the
//   faces of `faces` (an explicit face list, pointer-bound: the tool's stroke) or, when `faces` is null, on the
//   selected faces. Symmetry class `expand`: the runtime already passes the expanded selection; explicit faces are
//   mirrored here through the partner map. Faces without a partner are painted on their side only and reported
//   (`symmetry.unmatched-partner`, §5.14). Hidden faces are never painted. The selection is kept.
// - `mesh.paint.fillShell {slot, face}` (Shift+click with the tool): the shell of `face` (faces connected through
//   shared vertices, the Separate rule of §5.13; hidden faces neither painted nor crossed), and under symmetry the
//   shell of the mirrored face (pointer class).
// - `mesh.paint.remap {from, to}` (internal; `palette.replaceSwatch` runs it on each target): every face of slot
//   `from` gets `to`, hidden or not (a palette edit, not a component edit of a region).
//
// Positions and topology are untouched (`topology: false`); a run that writes nothing still succeeds (the runtime
// writes no revision then). Refusals: `paint.no-faces`, `paint.out-of-range`, `paint.no-face`.
import { coerceArgs, type ParamValues } from '@ekza-studio/anim-core';
import { BUILTIN_LAYERS } from '../../layers/builtin';
import { refuse } from '../../refusal';
import { selectionOf } from '../../selection';
import type {
  AttrLayer,
  ComponentSelection,
  EditMesh,
  MeshOp,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
  SymmetryMap,
} from '../../types';
import { PAINT, PAINT_FILL_SHELL, PAINT_REMAP } from './descriptor';

/** The `symmetry.unmatched-partner` warning of §5.14 for faces processed on their own side only. */
export const UNMATCHED_PARTNER = 'symmetry.unmatched-partner';

/** The paint layer (added with its default, slot 0, when the mesh has none). */
function paintLayer(m: EditMesh): AttrLayer {
  return m.layer(BUILTIN_LAYERS.paint.name) ?? m.addLayer(BUILTIN_LAYERS.paint);
}

/** The slot a face paints with (0 without a paint layer). */
export function faceSlot(m: EditMesh, f: number): number {
  return m.layer(BUILTIN_LAYERS.paint.name)?.get(f, 0) ?? 0;
}

const hiddenFace = (ctx: OpContext, f: number): boolean => ctx.hidden?.faces.has(f) === true;

function keptSelection(m: EditMesh, sel: ComponentSelection | null): ComponentSelection {
  return sel ?? selectionOf('face', [], m.counts);
}

function unmatched(faces: readonly number[]): OpWarning | null {
  if (faces.length === 0) return null;
  const elements = Uint32Array.from([...faces].sort((a, b) => a - b));
  return {
    code: UNMATCHED_PARTNER,
    message: `No mirror partner: applied to one side (${elements.length} face${elements.length === 1 ? '' : 's'})`,
    count: elements.length,
    elements,
  };
}

/** Adds the partners of `faces` (map.face); faces whose partner is −1 are returned as unmatched. */
function mirrorFaces(faces: Set<number>, map: SymmetryMap | null): number[] {
  const lonely: number[] = [];
  if (map === null) return lonely;
  // A snapshot: the partners added below are not walked again.
  for (const f of Array.from(faces)) {
    const partner = f < map.face.length ? (map.face[f] as number) : -1;
    if (partner < 0) lonely.push(f);
    else faces.add(partner);
  }
  return lonely;
}

/** Writes `slot` on `faces` (ascending), skipping faces that already have it. */
function writeSlot(m: EditMesh, faces: Iterable<number>, slot: number): number {
  const sorted = [...faces].sort((a, b) => a - b);
  let layer = m.layer(BUILTIN_LAYERS.paint.name) ?? null;
  let written = 0;
  for (const f of sorted) {
    if ((layer?.get(f, 0) ?? 0) === slot) continue;
    layer ??= paintLayer(m);
    layer.set(f, 0, slot);
    written += 1;
  }
  return written;
}

function isFaceList(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((f) => typeof f === 'number' && Number.isInteger(f));
}

// ---------- mesh.paint ----------

function paintPoll(m: EditMesh): true | Refusal {
  return m.counts.faces > 0 ? true : refuse('paint.no-faces', 'The mesh has no faces to paint');
}

function paintRun(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
  const { args } = coerceArgs(PAINT.params, raw);
  const slot = args['slot'] as number;
  const explicit = args['faces'];
  const faces = new Set<number>();
  if (explicit !== null && explicit !== undefined) {
    if (!isFaceList(explicit)) return refuse('paint.out-of-range', 'faces must be a list of face indices');
    for (const f of explicit) {
      if (f < 0 || f >= m.counts.faces) {
        return refuse('paint.out-of-range', `Face ${f} is outside 0…${m.counts.faces - 1}`);
      }
      faces.add(f);
    }
  } else if (sel !== null && sel.kind === 'face') {
    sel.faces.forEach((f) => {
      if (f < m.counts.faces) faces.add(f);
    });
  }
  // The runtime expands a selection for `expand` ops; explicit faces (a tool stroke) are mirrored here. Expanding a
  // selection that is already expanded adds nothing, and its lonely faces are reported either way.
  const lonely = mirrorFaces(faces, ctx.symmetry?.map ?? null);
  for (const f of faces) if (hiddenFace(ctx, f)) faces.delete(f);
  if (faces.size === 0) return refuse('paint.no-faces', 'Select faces to paint');
  writeSlot(m, faces, slot);
  const warning = unmatched(lonely.filter((f) => !hiddenFace(ctx, f)));
  return {
    selection: keptSelection(m, sel),
    warnings: warning === null ? [] : [warning],
    resolvedArgs: Object.freeze({
      slot,
      faces: explicit === null || explicit === undefined ? null : [...explicit].sort((a, b) => a - b),
    }),
  };
}

export const paint: MeshOp = Object.freeze({ ...PAINT, poll: paintPoll, run: paintRun });

// ---------- mesh.paint.fillShell ----------

/** Faces of the shell of `seed` (connected through shared vertices), never crossing hidden faces; ascending. */
export function faceShell(m: EditMesh, seed: number, hidden?: (f: number) => boolean): number[] {
  const isHidden = hidden ?? (() => false);
  if (seed < 0 || seed >= m.counts.faces || isHidden(seed)) return [];
  const seen = new Uint8Array(m.counts.faces);
  const visitedVert = new Uint8Array(m.counts.points);
  const stack = [seed];
  seen[seed] = 1;
  const out: number[] = [];
  while (stack.length > 0) {
    const f = stack.pop() as number;
    out.push(f);
    const first = m.faceCorner(f);
    let c = first;
    do {
      const v = m.cornerVert(c);
      if (visitedVert[v] === 0) {
        visitedVert[v] = 1;
        // Every face around v: walk its edges' radial cycles.
        const e0 = m.vertEdge(v);
        if (e0 >= 0) {
          let e = e0;
          do {
            const start = m.edgeCorner(e);
            if (start >= 0) {
              let r = start;
              do {
                const g = m.cornerFace(r);
                if (seen[g] === 0 && !isHidden(g)) {
                  seen[g] = 1;
                  stack.push(g);
                }
                r = m.cornerRadialNext(r);
              } while (r !== start);
            }
            e = m.edgeDiskNext(e, v);
          } while (e !== e0 && e >= 0);
        }
      }
      c = m.cornerNext(c);
    } while (c !== first);
  }
  return out.sort((a, b) => a - b);
}

function fillPoll(m: EditMesh): true | Refusal {
  return m.counts.faces > 0 ? true : refuse('paint.no-faces', 'The mesh has no faces to paint');
}

function fillRun(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
  const { args } = coerceArgs(PAINT_FILL_SHELL.params, raw);
  const slot = args['slot'] as number;
  const face = args['face'];
  if (typeof face !== 'number' || !Number.isInteger(face)) return refuse('paint.no-face', 'Click a face to fill');
  if (face < 0 || face >= m.counts.faces) {
    return refuse('paint.out-of-range', `Face ${face} is outside 0…${m.counts.faces - 1}`);
  }
  const isHidden = (f: number): boolean => hiddenFace(ctx, f);
  if (isHidden(face)) return refuse('paint.no-face', 'The clicked face is hidden');
  const faces = new Set(faceShell(m, face, isHidden));
  const warnings: OpWarning[] = [];
  const map = ctx.symmetry?.map ?? null;
  if (map !== null) {
    const partner = face < map.face.length ? (map.face[face] as number) : -1;
    if (partner < 0) {
      const warning = unmatched([face]);
      if (warning !== null) warnings.push(warning);
    } else if (!faces.has(partner)) {
      for (const f of faceShell(m, partner, isHidden)) faces.add(f);
    }
  }
  writeSlot(m, faces, slot);
  return { selection: keptSelection(m, sel), warnings, resolvedArgs: Object.freeze({ slot, face }) };
}

export const paintFillShell: MeshOp = Object.freeze({ ...PAINT_FILL_SHELL, poll: fillPoll, run: fillRun });

// ---------- mesh.paint.remap ----------

function remapRun(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues): OpResult {
  const { args } = coerceArgs(PAINT_REMAP.params, raw);
  const from = args['from'] as number;
  const to = args['to'] as number;
  if (from !== to) {
    const faces: number[] = [];
    for (let f = 0; f < m.counts.faces; f++) if (faceSlot(m, f) === from) faces.push(f);
    writeSlot(m, faces, to);
  }
  return { selection: keptSelection(m, sel), warnings: [], resolvedArgs: Object.freeze({ from, to }) };
}

export const paintRemap: MeshOp = Object.freeze({ ...PAINT_REMAP, poll: () => true as const, run: remapRun });
