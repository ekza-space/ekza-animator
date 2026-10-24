// The grammar's verb source (STUDIO-TOUCH-SPEC §6.1–§6.3, §20.2): which noun the selection is, its first-layer
// petals and its ⋯ More rows. The curated table, the noun resolver and the derived More list are work package T6b's
// (`verbs/{nouns,table,derive}.ts`, over the Disclosure Manifest); until they are wired in at integration this module
// is the stand-in the grammar runs on — a few real operators per noun, in the spec's slot order (§6.2), so taps,
// petals, the ring and More work end to end. The shape (`VerbSource`) is the seam the integration keeps.
import type { CharacterId, ControlId, JointId } from '@ekza-studio/doc';
import type { EditorApp, HaloStage, OperatorId, PollResult } from '@ekza-studio/editor-core';
import type { CompassSlot } from '@ekza-studio/ui/touch';
import { en } from '../i18n/en';
import { PANE } from '../shell/stage';
import type { VerbIcon } from './icons';

/** The noun kinds the grammar resolves from the selection (§6.2 rows). */
export type NounKind = 'space' | 'object' | 'face' | 'edge' | 'vertex' | 'character' | 'control' | 'joint';

/** One crumb of the breadcrumb (§6.5): tap it to select that ancestor. */
export interface Crumb {
  readonly label: string;
  readonly select?: { readonly op: OperatorId; readonly args?: unknown };
}

export interface Noun {
  readonly kind: NounKind;
  /** The lead record's id (the test API's `noun.id`), null for empty space and component sets. */
  readonly id: string | null;
  /** What the Halo's header and the screen reader say: "2 faces", "L Upper Arm", "3 parts". */
  readonly label: string;
  readonly count: number;
  readonly crumbs: readonly Crumb[];
}

/** What a verb does: an operator run (with a form first when it has one, §5.6), or a stage switch. */
export type VerbAction = { readonly op: OperatorId; readonly args?: unknown } | { readonly stage: HaloStage };

export interface Verb {
  /** Stable id (the operator id, or `stage:<stage>`). */
  readonly id: string;
  readonly label: string;
  readonly run: VerbAction;
  /** Pro's name, shown in More and read after the label (§6.3, P8). */
  readonly proName?: string;
  readonly icon?: VerbIcon;
  /** The long-press ring's compass slot (Pro's marking-menu direction where one exists, §6.1). */
  readonly slot?: CompassSlot;
  readonly hasMenu?: boolean;
  /** The verb changed in place (⟳ Again, Paste ▾, §6.1). */
  readonly changed?: boolean;
  /** §6.4: the verb needs a second thing — it waits for a tap on the target, then runs with the target as `parent`. */
  readonly target?: boolean;
}

export interface VerbSource {
  noun(app: EditorApp, stage: HaloStage): Noun | null;
  /** At most six, in slot order; the grammar greys the ones whose poll fails (§6.3). */
  petals(app: EditorApp, noun: Noun, stage: HaloStage): readonly Verb[];
  /** ⋯ More: everything else that applies (the full derivation is T6b's). */
  more(app: EditorApp, noun: Noun, stage: HaloStage): readonly Verb[];
}

// ---------- nouns ----------

const recordName = (app: EditorApp, table: 'controls' | 'meshes' | 'joints' | 'characters', id: string): string => {
  const record = (app.store.get as (t: string, i: string) => { readonly name?: string } | undefined)(table, id);
  return record?.name ?? id;
};

function characterOfControl(app: EditorApp, control: ControlId): CharacterId | null {
  const rig = app.store.get('controls', control)?.rig;
  if (rig === undefined) return null;
  return app.store.list('characters').find((c) => c.rig === rig)?.id ?? null;
}

function controlNoun(app: EditorApp, controls: readonly ControlId[]): Noun {
  const lead = controls[controls.length - 1] as ControlId;
  const character = characterOfControl(app, lead);
  const record = app.store.get('controls', lead);
  const crumbs: Crumb[] = [];
  if (character !== null) crumbs.push({ label: recordName(app, 'characters', character) });
  if (controls.length === 1 && record?.parent !== null && record?.parent !== undefined) {
    crumbs.push({
      label: recordName(app, 'controls', record.parent),
      select: { op: 'select.controls', args: { ids: [record.parent], mode: 'replace' } },
    });
  }
  const label = controls.length === 1 ? recordName(app, 'controls', lead) : en.halo.parts(controls.length);
  crumbs.push({ label });
  return { kind: 'control', id: lead, label, count: controls.length, crumbs };
}

function jointNoun(app: EditorApp, joints: readonly JointId[]): Noun {
  const lead = joints[joints.length - 1] as JointId;
  const label = joints.length === 1 ? recordName(app, 'joints', lead) : en.halo.parts(joints.length);
  return { kind: 'joint', id: lead, label, count: joints.length, crumbs: [{ label: en.halo.skeleton }, { label }] };
}

/** The noun the selection is in a stage (the stand-in for T6b's `resolveNoun`). */
export function resolveNoun(app: EditorApp, stage: HaloStage): Noun | null {
  const state = app.session.getState();
  const { selection } = state;
  if (stage === 'make' || stage === 'paint') {
    const mode = state.model.componentMode;
    const selected = state.model.components.selected;
    const mesh = state.model.hilite[state.model.hilite.length - 1] ?? null;
    const meshCrumbs = (label: string): Crumb[] => [
      { label: en.halo.scene },
      ...(mesh === null
        ? []
        : [
            {
              label: recordName(app, 'meshes', mesh),
              select: { op: 'select.mode' as OperatorId, args: { mode: 'object' } },
            },
          ]),
      { label },
    ];
    if (mode === 'face' && selected.face > 0) {
      const label = en.halo.faces(selected.face);
      return { kind: 'face', id: mesh, label, count: selected.face, crumbs: meshCrumbs(label) };
    }
    if (mode === 'edge' && selected.edge > 0) {
      const label = en.halo.edges(selected.edge);
      return { kind: 'edge', id: mesh, label, count: selected.edge, crumbs: meshCrumbs(label) };
    }
    if (mode === 'vertex' && selected.vertex > 0) {
      const label = en.halo.points(selected.vertex);
      return { kind: 'vertex', id: mesh, label, count: selected.vertex, crumbs: meshCrumbs(label) };
    }
    if (selection.objects.length > 0) {
      const lead = selection.objects[selection.objects.length - 1] as string;
      const label =
        selection.objects.length === 1 ? recordName(app, 'meshes', lead) : en.halo.parts(selection.objects.length);
      return {
        kind: 'object',
        id: lead,
        label,
        count: selection.objects.length,
        crumbs: [{ label: en.halo.scene }, { label }],
      };
    }
  }
  if (selection.joints.length > 0) return jointNoun(app, selection.joints);
  if (selection.controls.length > 0) return controlNoun(app, selection.controls);
  if (stage === 'rig' && selection.objects.length > 0) {
    const lead = selection.objects[selection.objects.length - 1] as string;
    const label = recordName(app, 'meshes', lead);
    return { kind: 'object', id: lead, label, count: selection.objects.length, crumbs: [{ label }] };
  }
  return null;
}

/** Empty space: the noun of a long-press on nothing (§6.2 first row; docked in the tray at rest). */
export function spaceNoun(): Noun {
  return { kind: 'space', id: null, label: en.halo.emptySpace, count: 0, crumbs: [] };
}

// ---------- petals (the stand-in table, §6.2) ----------

const op = (
  id: OperatorId,
  label: string,
  icon?: VerbIcon,
  slot?: CompassSlot,
  args?: unknown,
  extra?: Partial<Verb>,
): Verb => ({
  id: args === undefined ? id : `${id}:${JSON.stringify(args)}`,
  label,
  run: args === undefined ? { op: id } : { op: id, args },
  ...(icon === undefined ? {} : { icon }),
  ...(slot === undefined ? {} : { slot }),
  ...extra,
});

const toStage = (stage: HaloStage, label: string, icon: VerbIcon): Verb => ({
  id: `stage:${stage}`,
  label,
  run: { stage },
  icon,
});

const v = en.verbs;

function table(app: EditorApp, noun: Noun, stage: HaloStage): Verb[] {
  const state = app.session.getState();
  switch (noun.kind) {
    case 'space':
      if (stage === 'animate') {
        return [
          op('clip.new', v.newAnimation, 'clip', 'N'),
          op('key.set', v.keyAll, 'key', 'E', { target: 'character' }),
          op('select.all', v.allControls, 'select', 'S'),
          op('pose.resetToRest', v.resetPose, 'reset', 'W'),
        ];
      }
      if (stage === 'rig') {
        return [
          op('select.joints', v.allJoints, 'select', 'N', { all: true }),
          op('skin.bind', v.bindSkin, 'bind', 'E', {}),
        ];
      }
      return [
        op('mesh.create.cube', v.newShape, 'shape', 'N', undefined, { hasMenu: false }),
        op('select.objects', v.selectAll, 'select', 'E', { all: 'meshes', mode: 'replace' }),
        op('view.showAll', v.showAll, 'eye', 'S'),
      ];
    case 'object':
      return [
        op('select.mode', v.editShape, 'faces', 'N', { mode: 'face' }),
        op('scene.duplicate', v.duplicate, 'duplicate', 'E'),
        toStage('paint', v.paint, 'paint'),
        toStage('rig', v.rigIt, 'rig'),
        op('scene.parent', v.parentTo, 'connect', 'W', undefined, { target: true }),
        op('scene.delete', v.delete, 'delete', 'SW'),
      ];
    case 'face':
      return [
        op('mesh.extrude', v.pull, 'pull', 'N'),
        op('mesh.inset', v.inset, 'inset', 'E'),
        op('mesh.bevel', v.bevel, 'bevel', 'S'),
        op('mesh.delete', v.delete, 'delete', 'SW'),
      ];
    case 'edge':
      return [
        op('mesh.insertLoop', v.loopCut, 'cut', 'N'),
        op('mesh.bevel', v.bevel, 'bevel', 'E'),
        op('mesh.merge', v.merge, 'merge', 'S'),
        op('mesh.slide', v.slide, 'slide', 'W'),
        op('mesh.delete', v.delete, 'delete', 'SW'),
      ];
    case 'vertex':
      return [
        op('mesh.merge', v.merge, 'merge', 'N'),
        op('mesh.targetWeld', v.weldTo, 'weld', 'E'),
        op('mesh.slide', v.slide, 'slide', 'S'),
        op('mesh.connect', v.connect, 'connect', 'W'),
        op('mesh.delete', v.delete, 'delete', 'SW'),
      ];
    case 'control':
    case 'character': {
      const paste = state.clipboard.pose !== null;
      return [
        op('key.set', v.key, 'key', 'N'),
        op('pose.mirror', v.mirrorPose, 'mirror', 'E', { mode: 'flip' }, { hasMenu: true }),
        op('pose.resetToRest', v.reset, 'reset', 'S'),
        paste
          ? op('pose.paste', v.pastePose, 'paste', 'W', undefined, { changed: true, hasMenu: true })
          : op('pose.copy', v.copyPose, 'copy', 'W'),
      ];
    }
    case 'joint':
      return [
        op('skel.joint.orient', v.orient, 'orient', 'N'),
        op('skel.joint.mirror', v.mirror, 'mirror', 'E'),
        op('rig.mode', v.paint, 'paint', 'S', { mode: 'skin' }),
      ];
  }
}

const MORE: Readonly<Record<NounKind, readonly OperatorId[]>> = {
  space: ['view.showAll', 'select.all', 'file.new'],
  object: ['mesh.freezeTransforms', 'mesh.resetTransforms', 'mesh.triangulate', 'mesh.quadrangulate', 'mesh.cleanup'],
  face: [
    'mesh.extract',
    'mesh.duplicateFaces',
    'mesh.fillHole',
    'select.mesh.grow',
    'select.mesh.shrink',
    'select.mesh.shell',
  ],
  edge: ['mesh.soften', 'mesh.harden', 'mesh.offsetLoop', 'mesh.connect', 'select.mesh.grow', 'select.mesh.shrink'],
  vertex: ['mesh.averageVertices', 'mesh.collapse', 'mesh.deleteEdgeVertex', 'select.mesh.grow', 'select.mesh.shrink'],
  character: ['pose.copy', 'pose.resetToRest', 'select.all'],
  control: ['select.mirror', 'pose.copy', 'key.delete', 'select.none'],
  joint: ['skel.joint.orient', 'skel.joint.mirror', 'select.none'],
};

/** The stand-in verb source: a few real operators per noun (T6b's curated table replaces it). */
export const standInVerbs: VerbSource = {
  noun: resolveNoun,
  petals(app, noun, stage) {
    const petals = table(app, noun, stage);
    // §6.1: after a repeatable operation the last petal becomes ⟳ Again (`edit.repeatLast`); its slot stays.
    const last = app.session.getState().lastRun;
    if (last !== null && last.repeatable && last.closed === null && petals.some((p) => opOf(p) === last.id)) {
      const label = petals.find((p) => opOf(p) === last.id)?.label ?? last.label;
      const again = op('edit.repeatLast', v.again(label), 'again', petals.at(-1)?.slot, undefined, { changed: true });
      if (petals.length >= 4) petals[petals.length - 1] = again;
      else petals.push(again);
    }
    return petals.slice(0, 6);
  },
  more(app, noun, stage) {
    const petals = new Set(table(app, noun, stage).map((p) => p.id));
    return MORE[noun.kind]
      .filter((id) => app.operators.get(id) !== undefined && !petals.has(id))
      .map((id) => op(id, app.operators.get(id)?.label ?? id));
  },
};

/** The operator a verb runs, or null for a stage switch. */
export function opOf(verb: Verb): OperatorId | null {
  return 'op' in verb.run ? verb.run.op : null;
}

/** A verb's poll in the single pane: true, or the reason it cannot run now (§6.3: greyed with the reason). */
export function pollVerb(app: EditorApp, verb: Verb): PollResult {
  if (!('op' in verb.run)) return true;
  // a verb → target cannot be polled before its target is tapped (§6.4); its run is
  if (verb.target === true)
    return app.operators.get(verb.run.op) === undefined ? { ok: false, reason: en.sheet.soon } : true;
  if (app.operators.get(verb.run.op) === undefined) return { ok: false, reason: en.sheet.soon };
  try {
    return app.operators.poll(verb.run.op, { panel: 'viewport', paneId: PANE }, verb.run.args);
  } catch {
    return true;
  }
}

/** Pro's name of a verb's operator (More, the accessible name). */
export function proNameOf(app: EditorApp, verb: Verb): string | undefined {
  const id = opOf(verb);
  if (id === null) return undefined;
  const label = app.operators.get(id)?.label;
  return label === undefined || label === verb.label ? undefined : label;
}
