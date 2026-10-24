// STUDIO-TOUCH-SPEC §5.5 (T6a): the Thumb key's modifier map — which row is in force, what each meaning hands the tools,
// and that the selection meanings are exactly what Studio Pro's select tool reads as add / toggle / remove.
import { TOOL_HOLD_CODES } from '@ekza-studio/editor-core';
import { selectModeOf } from '@ekza-studio/viewport';
import { describe, expect, it } from 'vitest';
import { coachText, MODIFIER_MAP, modsOf, type ThumbSituation, thumbRow } from '../src/input/modifierMap';
import { meaningsOf } from '../src/input/situation';

const base: ThumbSituation = {
  stage: 'animate',
  tool: 'select',
  selected: false,
  rigMode: 'object',
  jointSelected: false,
  softSelect: false,
  extrude: false,
  sheet: null,
};

describe('modifierMap (§5.5)', () => {
  it('hides the key when neither line would change the next tap or drag', () => {
    expect(thumbRow(base)).toBeNull();
    expect(thumbRow({ ...base, selected: true, sheet: 'share' })).toBeNull();
  });

  it('something selected: Select more for taps; in Animate Fine for drags', () => {
    const animate = thumbRow({ ...base, selected: true });
    expect(animate?.tap?.id).toBe('selectMore');
    expect(animate?.drag?.id).toBe('fine');
    const make = thumbRow({ ...base, stage: 'make', selected: true });
    expect(make?.tap?.id).toBe('selectMore');
    expect(make?.drag).toBeUndefined();
  });

  it('the selection meanings are the select tool’s add, toggle and remove', () => {
    const row = thumbRow({ ...base, selected: true });
    const mode = (id: string): string => {
      const meaning = [row?.tap, ...(row?.choices ?? [])].find((m) => m?.id === id);
      const mods = modsOf(meaning);
      return selectModeOf({ shift: mods.shift, mod: mods.mod });
    };
    expect(mode('selectMore')).toBe('add');
    expect(mode('pick')).toBe('toggle');
    expect(mode('unselect')).toBe('remove');
  });

  it('tool rows: Multi-Cut, Paint Colour, weights, joints, extrude, falloff, Make transforms', () => {
    expect(thumbRow({ ...base, tool: 'multiCut' })?.tap?.id).toBe('snapPoint');
    expect(thumbRow({ ...base, stage: 'paint', tool: 'paint' })?.tap?.id).toBe('fillPart');
    const weights = thumbRow({ ...base, stage: 'rig', tool: 'paintSkinWeights' });
    expect([weights?.tap?.id, weights?.drag?.id]).toEqual(['sampleValue', 'brushSize']);
    expect(modsOf(weights?.drag).held.has('KeyB')).toBe(true);
    const joint = thumbRow({ ...base, stage: 'rig', rigMode: 'skeleton', jointSelected: true, selected: true });
    expect(modsOf(joint?.drag).held.has('KeyD')).toBe(true);
    expect(thumbRow({ ...base, stage: 'make', selected: true, extrude: true })?.drag?.id).toBe('smart');
    expect(thumbRow({ ...base, stage: 'make', selected: true, softSelect: true })?.drag?.id).toBe('falloffSize');
    const move = thumbRow({ ...base, stage: 'make', selected: true, tool: 'move' });
    expect(move?.drag?.id).toBe('snap');
    expect(modsOf(move?.drag).held.has('KeyX')).toBe(true);
  });

  it('every held code a meaning carries is one the tools observe (HOLD_CODES)', () => {
    // editor-core's HOLD_CODES = TOOL_HOLD_CODES + Paint Skin Weights' M and N (not exported from the root)
    const HOLD_CODES = [...TOOL_HOLD_CODES, 'KeyM', 'KeyN'];
    for (const row of MODIFIER_MAP) {
      for (const meaning of [row.tap, row.drag, ...row.choices]) {
        for (const code of meaning?.mods.held ?? []) expect(HOLD_CODES).toContain(code);
      }
    }
  });

  it('a chooser pick replaces its line for that row only', () => {
    const row = thumbRow({ ...base, selected: true });
    if (row === null) throw new Error('no row');
    expect(meaningsOf(row, { row: row.id, meaning: 'pick' }).tap?.id).toBe('pick');
    expect(meaningsOf(row, { row: row.id, meaning: 'coarse' }).drag?.id).toBe('coarse');
    expect(meaningsOf(row, { row: 'other', meaning: 'pick' }).tap?.id).toBe('selectMore');
  });

  it('coach text matches the label (§17)', () => {
    const row = thumbRow({ ...base, selected: true });
    expect(row === null ? '' : coachText(row)).toContain('select more');
  });
});
