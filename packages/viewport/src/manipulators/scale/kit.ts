// The lazy scale chunk (M6A-SPEC §4.7; B9): the Scale tool's behaviour, the scale drag maths and the scene-object
// targets, loaded when the Scale tool is first used (`./load.ts`). The ViewportManager reaches it through the loader.
import { type Mat4, mat4Decompose } from '@ekza-animator/anim-core';
import type { CharacterId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { objectWorld, pivotWorld, selectedObjects } from '../../manager/objects';
import type { ManipTarget } from '../ManipulatorKit';
import type { ScaleObject } from './math';

export { isScaleHandle, objectScaleDrag, scaleDrag } from './math';
export { createScaleTool } from './tool';

/** The manipulator on the lead selected scene object: its pivot and object axes in scene space, or null. */
export function objectManipTarget(
  app: Pick<EditorApp, 'store' | 'session'>,
  characterWorld: (character: CharacterId) => Mat4 | null,
): ManipTarget | null {
  const lead = selectedObjects(app).at(-1);
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

/** The selected scene objects at the start of a scale drag. */
export function scaleObjects(app: Pick<EditorApp, 'store' | 'session'>): readonly ScaleObject[] {
  return selectedObjects(app).map((record) => ({ id: record.id, placement: record.placement, pivot: record.pivot }));
}
