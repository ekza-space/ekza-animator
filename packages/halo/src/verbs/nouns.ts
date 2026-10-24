// Nouns (STUDIO-TOUCH-SPEC §3 P1, §6.1, §6.2; T6b): what the selection is, in Halo's words. Every pickable thing is a
// noun with a Halo (petals) and a ⋯ More list; `resolveNoun` reads the session selection (controls, joints, scene
// objects, mesh components, keys, channels) and names the noun the Halo, the breadcrumb, More and Numbers show. Pure:
// it reads the app, never writes it.
import type { ComponentMode, EditorApp, HaloStage } from '@ekza-studio/editor-core';
import type { NounKind } from '../manifest/types';

export interface Noun {
  readonly kind: NounKind;
  /** The record the noun stands for (mesh, control, joint, character, image plane, clip, …); null for empty space. */
  readonly id: string | null;
  /** Every selected record of this kind (several meshes, several controls). */
  readonly ids: readonly string[];
  /** The plain name shown in the breadcrumb and sheet titles ("Forearm R", "2 faces", "Cube Lad"). */
  readonly label: string;
  /** How many things (components count each face, edge or vertex). */
  readonly count: number;
  /** The character the noun belongs to, when it has one. */
  readonly character: string | null;
}

export const EMPTY_NOUN: Noun = {
  kind: 'empty',
  id: null,
  ids: [],
  label: 'Nothing selected',
  count: 0,
  character: null,
};

type ComponentKind = Exclude<ComponentMode, 'object'>;

const COMPONENT_NOUN: Readonly<Record<ComponentKind, NounKind>> = { vertex: 'vertices', edge: 'edges', face: 'faces' };
const COMPONENT_WORD: Readonly<Record<ComponentKind, readonly [string, string]>> = {
  vertex: ['point', 'points'],
  edge: ['edge', 'edges'],
  face: ['face', 'faces'],
};

const plural = (count: number, [one, many]: readonly [string, string]): string =>
  `${count} ${count === 1 ? one : many}`;

/** The character a control's rig belongs to. */
function characterOfRig(app: EditorApp, rig: string | null): string | null {
  if (rig === null) return null;
  const record = app.store.get('rigs' as never, rig as never) as { character?: string } | undefined;
  return record?.character ?? null;
}

/** Foot controls (§6.2 "Foot / IK goal control"): the leg IK goals and the foot-roll controls. */
function isFootControl(key: string): boolean {
  return /foot|ankle|toe|heel|leg\.ik|legik/i.test(key);
}

function controlNoun(app: EditorApp, ids: readonly string[]): Noun | null {
  const first = ids.at(-1);
  if (first === undefined) return null;
  const record = app.store.get('controls', first as never) as { key?: string; name?: string; rig?: string } | undefined;
  // A control id without its record (a rig being rebuilt, a fixture) is still a control: its id names it.
  const key = record?.key ?? '';
  const label = ids.length > 1 ? `${ids.length} parts` : (record?.name ?? (key === '' ? first : key));
  return {
    kind: ids.length === 1 && isFootControl(key) ? 'foot' : 'control',
    id: first,
    ids,
    label,
    count: ids.length,
    character: characterOfRig(app, record?.rig ?? null),
  };
}

function nameOf(app: EditorApp, table: string, id: string): string | null {
  const record = app.store.get(table as never, id as never) as { name?: string } | undefined;
  return record?.name ?? null;
}

/** The noun of the current selection in `stage` (Animate prefers controls; Rig prefers joints; Make components). */
export function resolveNoun(app: EditorApp, stage: HaloStage): Noun {
  const session = app.session.getState();
  const selection = session.selection;
  const controls = selection.controls;
  if (stage === 'animate' && controls.length > 0) {
    const noun = controlNoun(app, controls);
    if (noun !== null) return noun;
  }
  const joints = selection.joints;
  if (stage === 'rig' && joints.length > 0) {
    const first = joints.at(-1) as string;
    return {
      kind: 'joint',
      id: first,
      ids: joints,
      label: joints.length > 1 ? `${joints.length} joints` : (nameOf(app, 'joints', first) ?? 'Joint'),
      count: joints.length,
      character: null,
    };
  }
  const mode = session.model.componentMode;
  if ((stage === 'make' || stage === 'paint') && mode !== 'object') {
    const count = session.model.components.selected[mode];
    const mesh = session.model.hilite.at(-1) ?? null;
    if (count > 0 && mesh !== null) {
      return {
        kind: COMPONENT_NOUN[mode],
        id: mesh,
        ids: [...session.model.hilite],
        label: plural(count, COMPONENT_WORD[mode]),
        count,
        character: null,
      };
    }
  }
  const objects = selection.objects;
  if (objects.length > 0) {
    const first = objects.at(-1) as string;
    if (app.store.get('imagePlanes' as never, first as never) !== undefined) {
      return {
        kind: 'imagePlane',
        id: first,
        ids: objects,
        label: nameOf(app, 'imagePlanes', first) ?? 'Reference',
        count: objects.length,
        character: null,
      };
    }
    return {
      kind: 'mesh',
      id: first,
      ids: objects,
      label: objects.length > 1 ? `${objects.length} parts` : (nameOf(app, 'meshes', first) ?? 'Mesh'),
      count: objects.length,
      character: null,
    };
  }
  if (controls.length > 0) {
    const noun = controlNoun(app, controls);
    if (noun !== null) return noun;
  }
  return EMPTY_NOUN;
}

/** The noun of a character (the breadcrumb root; Rig › Character). */
export function characterNoun(app: EditorApp, character: string): Noun {
  return {
    kind: 'character',
    id: character,
    ids: [character],
    label: nameOf(app, 'characters', character) ?? 'Character',
    count: 1,
    character,
  };
}
