// AS-ST-20, ST-38 (T6a): every `UiDialog` value has a Halo surface (or is listed as deferred); an unknown value opens
// nothing but *Open in the Pro layout ▸*.
import type { UiDialog } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { DIALOG_SURFACES, surfaceOf } from '../src/dialogs/map';

/** Every `UiDialog` value (editor-core `types.ts`); the Record type also fails to compile on a missing one. */
const ALL: readonly UiDialog[] = [
  'open',
  'import',
  'export',
  'shortcuts',
  'about',
  'firstRun',
  'preferences',
  'recovery',
  'makeEditableReport',
  'imagePlaneImport',
  'layoutPresets',
  'applyPoseAsRest',
  'unbindSkin',
  'rebindSkin',
  'vrmMeta',
  'makeCharacterEditable',
  'attachProp',
];

describe('kernel questions → Halo surfaces (§6.7)', () => {
  it('every UiDialog value has a row', () => {
    expect(Object.keys(DIALOG_SURFACES).sort()).toEqual([...ALL].sort());
  });

  it('maps the table of §6.7', () => {
    expect(surfaceOf('rebindSkin').kind).toBe('confirm');
    expect(surfaceOf('unbindSkin').kind).toBe('confirm');
    expect(surfaceOf('applyPoseAsRest').kind).toBe('confirm');
    expect(surfaceOf('export')).toEqual({ kind: 'sheet', sheet: 'share' });
    expect(surfaceOf('vrmMeta')).toEqual({ kind: 'sheet', sheet: 'about' });
    expect(surfaceOf('preferences')).toEqual({ kind: 'sheet', sheet: 'settings' });
    expect(surfaceOf('shortcuts')).toEqual({ kind: 'sheet', sheet: 'help' });
    expect(surfaceOf('recovery').kind).toBe('home');
    expect(surfaceOf('firstRun').kind).toBe('noop');
    expect(surfaceOf('layoutPresets').kind).toBe('pro');
    expect(surfaceOf('makeCharacterEditable').kind).toBe('deferred');
    expect(surfaceOf('attachProp').kind).toBe('deferred');
  });

  it('an unknown value offers the Pro layout instead of a dead end', () => {
    expect(surfaceOf('extension.dialog')).toEqual({ kind: 'pro' });
  });
});
