// The lazy scale chunk (M6A-SPEC §4.7; B9): the Scale tool's behaviour, the scale drag maths and the scene-object
// targets, loaded when the Scale tool is first used (`./load.ts`). The ViewportManager reaches it through the loader.
import { type Mat4, mat4Decompose } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { objectWorld, pivotWorld, topmostSelectedObjects } from '../../manager/objects';
import type { ManipTarget } from '../ManipulatorKit';
import type { ScaleObject } from './math';

export { isScaleHandle, objectScaleDrag, scaleDrag } from './math';
export { createScaleTool } from './tool';

/**
 * The manipulator on the lead of the objects a scale applies to (the last selected object without a selected
 * ancestor): its pivot and object axes in scene space, or null.
 */
export function objectManipTarget(
  app: Pick<EditorApp, 'store' | 'session'>,
  characterWorld: (character: CharacterId) => Mat4 | null,
): ManipTarget | null {
  const lead = topmostSelectedObjects(app).at(-1);
  if (lead === undefined) return null;
  const world = objectWorld(app, lead, characterWorld);
  const xf = mat4Decompose(world);
  const all: readonly [boolean, boolean, boolean] = [true, true, true];
  return {
    pivot: pivotWorld(world, lead.pivot),
    worldQ: xf.q,
    parentQ: xf.q,
    r: [0, 0, 0],
    order: 'xyz',
    keyable: { t: all, r: all, s: all },
  };
}

/**
 * The scene objects a scale drag changes, at its start: the selected objects without a selected ancestor (a selected
 * child of a selected group follows the group and is not scaled a second time).
 */
export function scaleObjects(app: Pick<EditorApp, 'store' | 'session'>): readonly ScaleObject[] {
  return topmostSelectedObjects(app).map((record) => ({
    id: record.id,
    placement: record.placement,
    pivot: record.pivot,
  }));
}
