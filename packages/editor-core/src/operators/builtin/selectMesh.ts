// Component and object selection in Model (M6A-SPEC §5.6, §6.2; B10). Every operator here carries `flags.selection`:
// in workspaces with `undoSelection` (Model) each gesture records one "Select" step (`selectionGesture`), never a doc
// step. Walkers (loops, rings, grow, shrink, convert, border, shell) are the kernel's (B2); under symmetry they read
// the expanded selection (the picks plus their partners) and the result is stored. Hidden components are never
// selected and stop the walkers.
//
// `select.components` also takes two pass-through keys the viewport's select tool sends (M6A-B10-3): `gesture`
// ('click' | 'marquee'; a click is remembered so that a double-click's loop gesture reads the selection from before
// its first click, §5.6 and M6A-B2-6) and `also` (the other hilited meshes one marquee covers, `{ mesh, indices }[]`:
// the whole marquee is one run, so it is one step even when the first mesh's part changes nothing).
import { EkzaError } from '@ekza-studio/anim-core';
import type { GroupId, MeshId } from '@ekza-studio/doc';
import type {
  BitSet,
  ComponentKind,
  ComponentSelection,
  Domain,
  EditMesh,
  HiddenSet,
  MeshData,
} from '@ekza-studio/mesh-core';
import { type MeshKernel, meshKernel } from '../../mesh';
import { meshCheckOptions } from '../../selection/component/meshCheck';
import { componentInternals, type ComponentServiceInternals } from '../../selection/component/service';
import { selectionGesture } from '../../selection/component/steps';
import type { EditorApp, OperatorContext, PollResult, SceneObjectId, SelectMode, SelectionGesture } from '../../types';
import { combine } from './select';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';
import { isEditableMesh, MODEL_ONLY_REASON } from './mode';
import { stubOperator } from './stub';

const KINDS: readonly ComponentKind[] = ['vertex', 'edge', 'face'];
const SELECT_MODES: readonly SelectMode[] = ['replace', 'toggle', 'add', 'remove'];
const LOOP_GESTURES = ['double', 'shift-double', 'mod-double'] as const;
const CONVERT_MODES = ['touching', 'contained', 'perimeter', 'border', 'shell', 'loop', 'ring'] as const;
type ConvertMode = (typeof CONVERT_MODES)[number];

/** Polls that every component operator shares. */
export const COMPONENT_MODE_FIRST = 'Enter a component mode first';
export const NOTHING_SELECTED = 'Nothing is selected';
export const EDGE_MODE_FIRST = 'Works on edges: enter edge mode first';

const isKind = (value: unknown): value is ComponentKind => KINDS.includes(value as ComponentKind);

/** The B10 internals, or an error when another selection service is installed. */
function internalsOf(app: EditorApp): ComponentServiceInternals {
  const internals = componentInternals(app.components);
  if (internals === null) throw new EkzaError('unsupported', 'The component selection service has no B10 internals');
  return internals;
}

function kernelOf(): MeshKernel {
  const kernel = meshKernel();
  if (kernel === null) throw new EkzaError('mesh-loading', 'Mesh tools are loading');
  return kernel;
}

/** The current component mode's kind, or null in object mode. */
function modeKind(app: EditorApp): ComponentKind | null {
  const mode = app.session.getState().model.componentMode;
  return mode === 'object' ? null : mode;
}

/** Hilited meshes whose runtime has edit links (component operators read them). */
function openHilite(app: EditorApp): MeshId[] {
  return app.session
    .getState()
    .model.hilite.filter((id) => app.meshes.get(id)?.mesh !== null && app.meshes.get(id)?.mesh !== undefined);
}

/** Model and a component mode with something hilited. */
function componentPoll(ctx: OperatorContext): PollResult {
  const state = ctx.app.session.getState();
  if (state.workspace !== 'model') return fail(MODEL_ONLY_REASON);
  if (state.model.componentMode === 'object') return fail(COMPONENT_MODE_FIRST);
  if (state.model.hilite.length === 0) return fail('Select a mesh first');
  if (meshKernel() === null) return fail('Mesh tools are loading');
  return OK;
}

/** Whether any hilited mesh has a visible selection of `kind`. */
function anySelected(app: EditorApp, kind: ComponentKind): boolean {
  return app.session.getState().model.hilite.some((id) => {
    try {
      const sel = app.components.get(id, kind);
      return !(kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces).isEmpty();
    } catch {
      return false;
    }
  });
}

const setOf = (
  sel: { readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet },
  kind: ComponentKind,
): BitSet => (kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces);

/** A selection value whose `kind` set holds every index of `set` (the other kinds empty). */
function selectionOfSet(
  kernel: MeshKernel,
  kind: ComponentKind,
  set: BitSet,
  sizes: { vertex: number; edge: number; face: number },
): ComponentSelection {
  const sel = kernel.selectionOf(kind, [], { points: sizes.vertex, edges: sizes.edge, faces: sizes.face, corners: 0 });
  set.forEach((i) => setOf(sel, kind).add(i));
  const order = set.toArray();
  return {
    ...sel,
    order: order.length === 0 ? null : order,
    active: order.length === 0 ? -1 : (order.at(-1) as number),
  };
}

/** A kernel walker on one mesh's expanded selection. */
type Walker = (kernel: MeshKernel, mesh: EditMesh, sel: ComponentSelection, hidden: HiddenSet) => ComponentSelection;

/**
 * The picked side of a walker result under symmetry (§5.6: "additive gestures store the picked side only (the partner
 * is derived)"). `result` is the walker on the expanded selection (what the user sees and ops read); the stored part
 * is its intersection with the walker on the stored picks alone (plus the picks themselves when the kind is kept), so
 * a loop walked from a derived partner is not stored and does not come back as a pick of its own. Without symmetry
 * the expanded selection is the stored one and `result` is returned as is (acceptance fix round 1: a one-sided Bridge
 * of an arm onto the +X hole saw the −X hole loop as a third pick).
 */
function pickedSide(
  app: EditorApp,
  mesh: MeshId,
  from: ComponentKind,
  to: ComponentKind,
  result: ComponentSelection,
  walkStored: (stored: ComponentSelection) => ComponentSelection,
): ComponentSelection {
  const internals = internalsOf(app);
  if (internals.mirrored(mesh, from) === null) return result;
  let stored: ComponentSelection;
  try {
    stored = app.components.get(mesh, from);
  } catch {
    return result;
  }
  const own = setOf(walkStored(stored), to);
  const picks = from === to ? setOf(stored, to) : null;
  const all = setOf(result, to);
  const keep = all.clone();
  all.forEach((i) => {
    if (!own.has(i) && picks?.has(i) !== true) keep.delete(i);
  });
  if (keep.equals(all)) return result;
  const sizes = internals.sizes(mesh);
  if (sizes === null) return result;
  const reduced = selectionOfSet(kernelOf(), to, keep, sizes);
  const order = result.order?.filter((i) => keep.has(i)) ?? null;
  return {
    ...reduced,
    order: order === null || order.length === 0 ? reduced.order : order,
    active: keep.has(result.active) ? result.active : reduced.active,
  };
}

/** Runs a walker per open hilited mesh on its expanded selection of `from`; stores the result as `to`. */
function walk(app: EditorApp, from: ComponentKind, to: ComponentKind, fn: Walker): void {
  const kernel = kernelOf();
  const internals = internalsOf(app);
  internals.batch(() => {
    for (const id of openHilite(app)) {
      const runtime = app.meshes.get(id);
      const sel = internals.expanded(id, from);
      const mesh = runtime?.mesh;
      if (mesh === null || mesh === undefined || sel === null) continue;
      const hidden = app.components.hidden(id);
      const result = fn(kernel, mesh, sel, hidden);
      internals.store(
        id,
        pickedSide(app, id, from, to, result, (stored) => fn(kernel, mesh, stored, hidden)),
        to,
      );
    }
  });
}

/** Switches the component mode (a conversion's result is shown in its kind, as desktop DCCs do). */
function showKind(app: EditorApp, kind: ComponentKind): void {
  const model = app.session.getState().model;
  if (model.componentMode !== kind) {
    app.session.setState({ model: { ...model, componentMode: kind, lastComponentMode: kind } });
  }
}

function walkerOperator(
  id: 'select.mesh.grow' | 'select.mesh.shrink' | 'select.mesh.shell',
  label: string,
  description: string,
  gesture: SelectionGesture,
  run: Walker,
  aliases?: readonly string[],
): AnyOperator {
  return defineOperator({
    id,
    label,
    description,
    category: 'select',
    scope: 'model',
    flags: { selection: true },
    workspaces: ['model'],
    ...(aliases === undefined ? {} : { aliases }),
    poll(ctx) {
      const ok = componentPoll(ctx);
      if (ok !== true) return ok;
      const kind = modeKind(ctx.app) as ComponentKind;
      return anySelected(ctx.app, kind) ? OK : fail(NOTHING_SELECTED);
    },
    apply(ctx) {
      const kind = modeKind(ctx.app) as ComponentKind;
      const repeat = ctx.repeat === true && (gesture === 'grow' || gesture === 'shrink');
      selectionGesture(ctx.app, gesture, { repeat }, () => walk(ctx.app, kind, kind, run));
    },
  });
}

// ---------- select.components (click and marquee) ----------

const isIndexList = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((i) => typeof i === 'number' && Number.isInteger(i) && i >= 0);

/** The `also` pass-through key (M6A-B10-3): [] when absent, null when malformed. */
function alsoOf(
  args: Readonly<Record<string, unknown>>,
): { readonly mesh: MeshId; readonly indices: number[] }[] | null {
  const also = args['also'];
  if (also === undefined) return [];
  if (!Array.isArray(also)) return null;
  const parts: { readonly mesh: MeshId; readonly indices: number[] }[] = [];
  for (const part of also as unknown[]) {
    if (!isRecord(part) || typeof part['mesh'] !== 'string' || !isIndexList(part['indices'])) return null;
    parts.push({ mesh: part['mesh'] as MeshId, indices: [...part['indices']] });
  }
  return parts;
}

const selectComponents = defineOperator({
  id: 'select.components',
  label: 'Select Components',
  description: 'Selects components of a mesh (click and marquee).',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['mesh', 'kind', 'indices', 'mode'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (
      !isRecord(args) ||
      typeof args['mesh'] !== 'string' ||
      !isKind(args['kind']) ||
      !Array.isArray(args['indices']) ||
      !SELECT_MODES.includes(args['mode'])
    ) {
      return fail('expects { mesh, kind, indices, mode }');
    }
    if (!isIndexList(args['indices'])) return fail('indices must be component indices');
    const also = alsoOf(args);
    if (also === null) return fail('also must be a list of { mesh, indices }');
    if (ctx.app.session.getState().workspace !== 'model') return fail(MODEL_ONLY_REASON);
    if (meshKernel() === null) return fail('Mesh tools are loading');
    for (const mesh of [args['mesh'], ...also.map((part) => part.mesh)]) {
      if (!isEditableMesh(ctx.app, mesh)) return fail(`Unknown mesh ${mesh}`);
      if (ctx.app.meshes.get(mesh)?.state !== 'ready') return fail('Mesh is loading');
    }
    return OK;
  },
  apply(ctx, args) {
    const app = ctx.app;
    const internals = internalsOf(app);
    const raw = args as unknown as Readonly<Record<string, unknown>>;
    const marquee = raw['gesture'] === 'marquee';
    const click = raw['gesture'] === 'click';
    const also = alsoOf(raw) ?? [];
    const hilite = app.session.getState().model.hilite;
    const meshes = [...hilite];
    for (const id of [args.mesh, ...also.map((part) => part.mesh)]) if (!meshes.includes(id)) meshes.push(id);
    const gesture: SelectionGesture = marquee
      ? 'marquee'
      : args.mode === 'replace'
        ? args.indices.length === 0
          ? 'clear'
          : 'replace'
        : 'additive';
    const before = click ? internals.freeze(args.mesh) : null;
    selectionGesture(app, gesture, { repeat: ctx.repeat === true, meshes }, () =>
      internals.batch(() => {
        // A replacing gesture replaces everything of the kind: the other hilited meshes lose theirs (§5.6).
        if (args.mode === 'replace') for (const id of hilite) if (id !== args.mesh) internals.clearKind(id, args.kind);
        app.components.apply(args.mesh, args.kind, args.indices, args.mode);
        // The other meshes of the same marquee add to a replace (the replace already cleared them).
        const rest: SelectMode = args.mode === 'replace' ? 'add' : args.mode;
        for (const part of also) app.components.apply(part.mesh, args.kind, part.indices, rest);
      }),
    );
    const index = args.indices[0];
    if (click && before !== null && args.indices.length === 1 && index !== undefined) {
      internals.noteClick({ mesh: args.mesh, kind: args.kind, index, before });
    }
  },
});

// ---------- loops and rings ----------

const selectLoop = defineOperator({
  id: 'select.mesh.loop',
  label: 'Select Loop',
  description: 'Selects the edge or face loop through a component.',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['mesh', 'kind', 'component', 'gesture'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (
      !isRecord(args) ||
      typeof args['mesh'] !== 'string' ||
      !isKind(args['kind']) ||
      typeof args['component'] !== 'number' ||
      !Number.isInteger(args['component']) ||
      !LOOP_GESTURES.includes(args['gesture'])
    ) {
      return fail('expects { mesh, kind, component, gesture: double | shift-double | mod-double }');
    }
    if (ctx.app.session.getState().workspace !== 'model') return fail(MODEL_ONLY_REASON);
    if (meshKernel() === null) return fail('Mesh tools are loading');
    const runtime = ctx.app.meshes.get(args['mesh']);
    if (runtime?.mesh === null || runtime?.mesh === undefined) return fail(COMPONENT_MODE_FIRST);
    return OK;
  },
  apply(ctx, args) {
    const app = ctx.app;
    const kernel = kernelOf();
    const internals = internalsOf(app);
    const runtime = app.meshes.get(args.mesh);
    const mesh = runtime?.mesh;
    if (mesh === null || mesh === undefined) throw new EkzaError('mesh-not-ready', COMPONENT_MODE_FIRST);
    // The first click of a double-click is not part of the gesture (M6A-B2-6): read the selection from before it.
    const clicked = internals.lastClick();
    const fromClick =
      clicked !== null && clicked.mesh === args.mesh && clicked.kind === args.kind && clicked.index === args.component;
    const hilite = app.session.getState().model.hilite;
    const meshes = hilite.includes(args.mesh) ? hilite : [...hilite, args.mesh];
    selectionGesture(app, 'loop', { meshes }, () =>
      internals.batch(() => {
        const current = internals.freeze(args.mesh);
        if (fromClick && clicked !== null) internals.restoreFrozen(args.mesh, clicked.before);
        const base = internals.expanded(args.mesh, args.kind);
        if (base === null) return;
        let result: ComponentSelection;
        try {
          result = kernel.loopGesture(
            mesh,
            base,
            args.kind,
            args.component,
            args.gesture,
            app.components.hidden(args.mesh),
          );
        } catch (error) {
          if (current !== null) internals.restoreFrozen(args.mesh, current);
          throw error;
        }
        if (args.gesture === 'double')
          for (const id of hilite) if (id !== args.mesh) internals.clearKind(id, args.kind);
        const hidden = app.components.hidden(args.mesh);
        const stored = pickedSide(app, args.mesh, args.kind, args.kind, result, (picks) =>
          kernel.loopGesture(mesh, picks, args.kind, args.component, args.gesture, hidden),
        );
        internals.store(args.mesh, stored, args.kind);
      }),
    );
  },
});

const selectRing = defineOperator({
  id: 'select.mesh.ring',
  label: 'Select Ring',
  description: 'Selects the edge ring through the selected edges.',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['mesh', 'component'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    const a = optionalArgs(args);
    if (a === null) return fail('expects { mesh?, component? }');
    const ok = componentPoll(ctx);
    if (ok !== true) return ok;
    if (modeKind(ctx.app) !== 'edge') return fail(EDGE_MODE_FIRST);
    if (a['mesh'] !== undefined || a['component'] !== undefined) {
      if (typeof a['mesh'] !== 'string' || typeof a['component'] !== 'number') {
        return fail('expects { mesh, component } together');
      }
      return OK;
    }
    return anySelected(ctx.app, 'edge') ? OK : fail(NOTHING_SELECTED);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const a = optionalArgs(args) ?? {};
    const mesh = a['mesh'] as MeshId | undefined;
    const component = a['component'] as number | undefined;
    if (mesh !== undefined && component !== undefined) {
      const kernel = kernelOf();
      const internals = internalsOf(app);
      const editMesh = app.meshes.get(mesh)?.mesh;
      if (editMesh === null || editMesh === undefined) throw new EkzaError('mesh-not-ready', COMPONENT_MODE_FIRST);
      const hilite = app.session.getState().model.hilite;
      selectionGesture(app, 'loop', { meshes: hilite.includes(mesh) ? hilite : [...hilite, mesh] }, () =>
        internals.batch(() => {
          const ring = kernel.edgeRing(editMesh, component, app.components.hidden(mesh));
          const sizes = internals.sizes(mesh);
          if (sizes === null) return;
          const set = new kernel.BitSet(sizes.edge);
          for (const e of ring) set.add(e);
          for (const id of hilite) if (id !== mesh) internals.clearKind(id, 'edge');
          internals.store(mesh, selectionOfSet(kernel, 'edge', set, sizes), 'edge');
        }),
      );
      return;
    }
    selectionGesture(app, 'loop', {}, () =>
      walk(app, 'edge', 'edge', (kernel, m, sel, hidden) => kernel.convertSelection(m, sel, 'edge', 'ring', hidden)),
    );
  },
});

// ---------- grow, shrink, shell, border, convert ----------

const grow = walkerOperator(
  'select.mesh.grow',
  'Grow Selection',
  'Grows the component selection by one ring of neighbours.',
  'grow',
  (kernel, mesh, sel, hidden) => kernel.growSelection(mesh, sel, hidden),
);
const shrink = walkerOperator(
  'select.mesh.shrink',
  'Shrink Selection',
  'Shrinks the component selection by one ring.',
  'shrink',
  (kernel, mesh, sel, hidden) => kernel.shrinkSelection(mesh, sel, hidden),
);
const shell = walkerOperator(
  'select.mesh.shell',
  'Select Shell',
  'Selects every component connected to the selection.',
  'convert',
  (kernel, mesh, sel, hidden) => kernel.convertSelection(mesh, sel, sel.kind, 'shell', hidden),
  ['Linked'],
);

const border = defineOperator({
  id: 'select.mesh.border',
  label: 'Select Border',
  description: 'Selects the border edges of the selected region.',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  workspaces: ['model'],
  poll: (ctx) => componentPoll(ctx),
  apply(ctx) {
    const app = ctx.app;
    const kind = modeKind(app) as ComponentKind;
    // With nothing selected "Select › Border" means every border loop of the mesh (M6A-B2-8).
    const everything = !anySelected(app, kind);
    selectionGesture(app, 'convert', {}, () => {
      walk(app, kind, 'edge', (kernel, mesh, sel, hidden) => {
        const source = everything ? allOf(kernel, mesh, 'face', hidden) : sel;
        return kernel.convertSelection(mesh, source, 'edge', 'border', hidden);
      });
      showKind(app, 'edge');
    });
  },
});

/** Every visible component of `kind` of a mesh, as a selection. */
function allOf(
  kernel: MeshKernel,
  mesh: {
    readonly counts: {
      readonly points: number;
      readonly edges: number;
      readonly faces: number;
      readonly corners: number;
    };
  },
  kind: ComponentKind,
  hidden: { readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet } | null,
): ComponentSelection {
  const size = kind === 'vertex' ? mesh.counts.points : kind === 'edge' ? mesh.counts.edges : mesh.counts.faces;
  const hiddenSet =
    hidden === null ? null : kind === 'vertex' ? hidden.verts : kind === 'edge' ? hidden.edges : hidden.faces;
  const indices: number[] = [];
  for (let i = 0; i < size; i++) if (hiddenSet === null || !hiddenSet.has(i)) indices.push(i);
  return kernel.selectionOf(kind, indices, mesh.counts);
}

const convert = defineOperator({
  id: 'select.mesh.convert',
  label: 'Convert Selection',
  description: 'Converts the selection to vertices, edges or faces.',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['to', 'mode'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (!isRecord(args) || !isKind(args['to'])) return fail('expects { to: vertex | edge | face, mode? }');
    if (args['mode'] !== undefined && !CONVERT_MODES.includes(args['mode'])) {
      return fail(`mode must be one of ${CONVERT_MODES.join(', ')}`);
    }
    const ok = componentPoll(ctx);
    if (ok !== true) return ok;
    return anySelected(ctx.app, modeKind(ctx.app) as ComponentKind) ? OK : fail(NOTHING_SELECTED);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const from = modeKind(app) as ComponentKind;
    const mode: ConvertMode = args.mode ?? 'touching';
    selectionGesture(app, 'convert', {}, () => {
      walk(app, from, args.to, (kernel, mesh, sel, hidden) =>
        kernel.convertSelection(mesh, sel, args.to, mode, hidden),
      );
      showKind(app, args.to);
    });
  },
});

// ---------- all, invert, none ----------

function wholeOperator(
  id: 'select.mesh.all' | 'select.mesh.invert' | 'select.mesh.none',
  label: string,
  description: string,
  gesture: SelectionGesture,
): AnyOperator {
  return defineOperator({
    id,
    label,
    description,
    category: 'select',
    scope: 'model',
    flags: { selection: true },
    workspaces: ['model'],
    poll: (ctx) => componentPoll(ctx),
    apply(ctx) {
      const app = ctx.app;
      const kind = modeKind(app) as ComponentKind;
      const internals = internalsOf(app);
      selectionGesture(app, gesture, {}, () =>
        internals.batch(() => {
          for (const mesh of app.session.getState().model.hilite) {
            if (id === 'select.mesh.none') {
              internals.clearKind(mesh, kind);
              continue;
            }
            const sizes = internals.sizes(mesh);
            if (sizes === null) continue;
            const hidden = setOf(app.components.hidden(mesh), kind);
            // Invert complements the expanded selection (the picks and their partners, §5.6): the complement of a
            // mirrored set is mirrored, so its expansion adds nothing back.
            const expanded = internals.expanded(mesh, kind);
            const current = setOf(expanded ?? app.components.get(mesh, kind), kind);
            const indices: number[] = [];
            for (let i = 0; i < sizes[kind]; i++) {
              if (hidden.has(i)) continue;
              if (id === 'select.mesh.all' || !current.has(i)) indices.push(i);
            }
            app.components.apply(mesh, kind, indices, 'replace');
          }
        }),
      );
    },
  });
}

// ---------- Mesh Check "select matching" ----------

const DOMAIN_KIND: Readonly<Record<Domain, ComponentKind>> = {
  point: 'vertex',
  edge: 'edge',
  face: 'face',
  corner: 'face',
};

/** The kind a code selects in when the mesh has none of it (the §5.25 detection domains). */
const CODE_KIND: Readonly<Record<string, ComponentKind>> = {
  'non-manifold-edge': 'edge',
  'non-manifold-vertex': 'vertex',
  'zero-length-edge': 'edge',
  'inconsistent-winding': 'edge',
  'stray-vertex': 'vertex',
  'loose-geometry': 'vertex',
  'open-border': 'edge',
};

/**
 * The components of a code's problems in one kind: the first problem's domain, the other domains' elements converted
 * to it (`loose-geometry` reports loose vertices and wire edges: in vertex mode the wire edges' endpoints).
 */
function matchingIndices(
  mesh: EditMesh | MeshData,
  problems: readonly { readonly elements?: Uint32Array; readonly domain?: Domain }[],
  kind: ComponentKind,
): number[] {
  const edit = typeof (mesh as Partial<EditMesh>).edgeVert === 'function' ? (mesh as EditMesh) : null;
  const endpoint = (e: number, end: 0 | 1): number =>
    edit !== null ? edit.edgeVert(e, end) : ((mesh as MeshData).edgeVerts[2 * e + end] as number);
  const out = new Set<number>();
  for (const problem of problems) {
    const domain = problem.domain === undefined ? kind : DOMAIN_KIND[problem.domain];
    for (const i of problem.elements ?? []) {
      if (domain === kind) out.add(i);
      else if (domain === 'edge' && kind === 'vertex') {
        out.add(endpoint(i, 0));
        out.add(endpoint(i, 1));
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

const selectMatching = defineOperator({
  id: 'select.mesh.matching',
  label: 'Select Matching',
  description: 'Selects the components a Mesh Check problem reports.',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['mesh', 'code'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (!isRecord(args) || typeof args['mesh'] !== 'string' || typeof args['code'] !== 'string') {
      return fail('expects { mesh, code }');
    }
    if (ctx.app.session.getState().workspace !== 'model') return fail(MODEL_ONLY_REASON);
    if (meshKernel() === null) return fail('Mesh tools are loading');
    return isEditableMesh(ctx.app, args['mesh']) ? OK : fail(`Unknown mesh ${args['mesh']}`);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const kernel = kernelOf();
    const runtime = app.meshes.get(args.mesh);
    const data = runtime?.mesh ?? runtime?.data() ?? null;
    if (data === null) throw new EkzaError('mesh-not-ready', `Mesh ${args.mesh} is not ready`);
    // The panel's options (hidden elements, the template's closed flag, the palette's duplicate slots, §5.25).
    const problems = kernel.checkMesh(data, meshCheckOptions(app, args.mesh)).filter((p) => p.code === args.code);
    const domain = problems.find((p) => p.domain !== undefined)?.domain;
    const kind = domain === undefined ? (CODE_KIND[args.code] ?? 'face') : DOMAIN_KIND[domain];
    const model = app.session.getState().model;
    const hilite = model.hilite.includes(args.mesh) ? model.hilite : [...model.hilite, args.mesh];
    const internals = internalsOf(app);
    selectionGesture(app, 'replace', { meshes: hilite }, () => {
      app.session.setState({ model: { ...model, componentMode: kind, lastComponentMode: kind, hilite } });
      internals.batch(() => {
        for (const id of hilite) if (id !== args.mesh) internals.clearKind(id, kind);
        app.components.apply(args.mesh, kind, matchingIndices(data, problems, kind), 'replace');
      });
    });
  },
});

// ---------- objects ----------

/** Every live mesh and group a pane may show (not hidden), for `Mod+A` in object mode. */
function visibleMeshes(app: EditorApp): SceneObjectId[] {
  const hidden = app.session.getState().model.hiddenObjects;
  return app.store
    .list('meshes')
    .filter((mesh) => mesh.deleted === null && !hidden.has(mesh.id))
    .map((mesh) => mesh.id);
}

const RIG_OBJECT_MODE_REASON = 'Objects are picked in Object mode';
const OBJECTS_REASON = 'Objects are selected in Model and Rig & Skin';

const selectObjects = defineOperator({
  id: 'select.objects',
  label: 'Select Objects',
  description: 'Selects meshes and groups (Model, and Rig & Skin in Object mode).',
  category: 'select',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['ids', 'all', 'mode'],
  workspaces: ['model', 'rig'],
  poll(ctx, args): PollResult {
    if (!isRecord(args) || !SELECT_MODES.includes(args['mode'])) {
      return fail('expects { ids?, all?: meshes, mode }');
    }
    if (args['ids'] !== undefined) {
      if (!Array.isArray(args['ids']) || !(args['ids'] as unknown[]).every((id) => typeof id === 'string')) {
        return fail('ids must be mesh or group ids');
      }
    }
    if (args['all'] !== undefined && args['all'] !== 'meshes') return fail("all must be 'meshes'");
    // M6b C7 (§5.24): Rig & Skin's Object mode picks meshes (the active character and Quick Rig read them).
    const state = ctx.app.session.getState();
    if (state.workspace === 'rig') return state.rig.mode === 'object' ? OK : fail(RIG_OBJECT_MODE_REASON);
    return state.workspace === 'model' ? OK : fail(OBJECTS_REASON);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const live = (id: string): boolean => {
      const record = app.store.get('meshes', id as MeshId) ?? app.store.get('groups', id as GroupId);
      return record !== undefined && record.deleted === null;
    };
    const ids = args.all === 'meshes' ? visibleMeshes(app) : (args.ids ?? []).filter(live);
    selectionGesture(app, 'objects', {}, () => {
      const selection = app.session.getState().selection;
      const objects = combine(selection.objects, ids, args.mode);
      app.session.setState({ selection: { ...selection, objects } });
    });
  },
});

export const SELECT_MESH_OPERATORS: readonly AnyOperator[] = [
  selectComponents,
  selectLoop,
  selectRing,
  grow,
  shrink,
  border,
  shell,
  wholeOperator(
    'select.mesh.all',
    'Select All Components',
    'Selects every component of the hilited meshes.',
    'replace',
  ),
  wholeOperator(
    'select.mesh.invert',
    'Invert Selection',
    'Inverts the component selection of the hilited meshes.',
    'replace',
  ),
  wholeOperator('select.mesh.none', 'Deselect Components', 'Clears the component selection.', 'clear'),
  convert,
  selectMatching,
  selectObjects,
  stubOperator('select.mesh.pickWalk', 'Pick Walk Components', {
    category: 'select',
    description: 'Walks the component selection to a neighbour.',
    scope: 'model',
    extraArgs: ['direction'],
    workspaces: ['model'],
    reason: 'Component pick-walk arrives later',
  }),
];
