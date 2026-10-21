// Palettes and swatches (M6A-SPEC §5.19, §6.2; B13): the default palette created by the first modeling action, slots
// never reused, swatch edits recolour, variants by duplicate, assign, Replace Swatch over `mesh.paint.remap`, the
// active swatch and Select by Swatch.
import type { MeshId, PaletteId, SwatchId } from '@ekza-studio/doc';
import { makeTestMesh } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE_ID, defaultSwatchId, nextSlot, paintRefusal, parseHex, toHex } from '../../../src';
// The default palette's table lives with the lazy operator bodies (M6A-B13-10).
import { DEFAULT_SWATCHES } from '../../../src/operators/builtin/contentApply';
import { counts, faceSlots, meshTestApp, paintFaces, pollReason, runValue, selectObjects } from './support';

async function cube(t: Awaited<ReturnType<typeof meshTestApp>>, args?: object): Promise<MeshId> {
  return (await runValue<{ mesh: MeshId }>(t, 'mesh.create.cube', args)).mesh;
}

describe('the default palette (§5.19)', () => {
  it('palette.ensureDefault creates "Ekza Default 16": slots 0–15, deterministic ids, the §5.19 colours', async () => {
    const t = await meshTestApp();
    const { palette } = await runValue<{ palette: PaletteId }>(t, 'palette.ensureDefault');
    expect(palette).toBe(DEFAULT_PALETTE_ID);
    expect(t.app.store.get('palettes', palette)?.name).toBe('Ekza Default 16');
    const swatches = t.app.store.query.swatchesOfPalette(palette);
    expect(swatches.map((s) => s.slot)).toEqual([...Array(16).keys()]);
    expect(swatches.map((s) => s.id)).toEqual([...Array(16).keys()].map(defaultSwatchId));
    expect(swatches.map((s) => toHex(s.srgb))).toEqual(DEFAULT_SWATCHES.map((s) => s.hex));
    expect(swatches[4]?.srgb).toEqual([0xe0, 0x46, 0x46]);
    expect(t.app.history.peekUndo()?.label).toBe('Use Ekza Default 16');
    // idempotent: a second run writes nothing (no step)
    const top = t.app.history.peekUndo()?.id;
    await runValue(t, 'palette.ensureDefault');
    expect(t.app.history.peekUndo()?.id).toBe(top);
    expect(t.app.store.query.swatchesOfPalette(palette)).toHaveLength(16);
  });

  it('the first modeling action creates it in the same step and assigns it to the new mesh', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    expect(t.app.store.get('meshes', id)?.palette).toBe(DEFAULT_PALETTE_ID);
    expect(t.app.store.query.swatchesOfPalette(DEFAULT_PALETTE_ID)).toHaveLength(16);
    t.app.history.undo();
    expect(t.app.store.get('palettes', DEFAULT_PALETTE_ID)).toBeUndefined();
    t.app.history.redo();
    expect(t.app.store.get('palettes', DEFAULT_PALETTE_ID)?.name).toBe('Ekza Default 16');
    // a second mesh reuses it
    const second = await cube(t);
    expect(t.app.store.get('meshes', second)?.palette).toBe(DEFAULT_PALETTE_ID);
    expect(t.app.store.list('palettes')).toHaveLength(1);
  });

  it('hex helpers round-trip', () => {
    expect(parseHex('#FF0000')).toEqual([255, 0, 0]);
    expect(parseHex('0f0')).toEqual([0, 255, 0]);
    expect(parseHex('#12345')).toBeNull();
    expect(toHex([255, 0, 128])).toBe('#ff0080');
  });
});

describe('swatches: slots are never reused', () => {
  it('adds at the next slot, removes softly, and the slot stays taken', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    const added = await runValue<{ swatch: SwatchId; slot: number }>(t, 'palette.addSwatch', {
      palette: DEFAULT_PALETTE_ID,
      srgb: [10, 20, 30],
      name: 'Navy',
    });
    expect(added.slot).toBe(16);
    expect(t.app.store.get('swatches', added.swatch)).toMatchObject({ name: 'Navy', srgb: [10, 20, 30], kind: 'flat' });
    await runValue(t, 'palette.removeSwatch', { swatch: added.swatch });
    expect(t.app.store.get('swatches', added.swatch)).toBeUndefined();
    expect(t.app.store.getIncludingDeleted('swatches', added.swatch)?.deleted).not.toBeNull();
    const again = await runValue<{ slot: number }>(t, 'palette.addSwatch', {
      palette: DEFAULT_PALETTE_ID,
      srgb: [1, 2, 3],
    });
    expect(again.slot).toBe(17);
    // a default swatch removed in the middle keeps its slot too
    await runValue(t, 'palette.removeSwatch', { swatch: defaultSwatchId(3) });
    expect(nextSlot(t.app.store, DEFAULT_PALETTE_ID)).toBe(18);
    // the undo of an add frees nothing that ever existed: the slot is simply never used
    t.app.history.undo();
    t.app.history.undo();
    expect(nextSlot(t.app.store, DEFAULT_PALETTE_ID)).toBe(17);
  });

  it('a swatch name defaults to its hex; colours are rounded 8-bit values; bad values fail the poll', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    const { swatch } = await runValue<{ swatch: SwatchId }>(t, 'palette.addSwatch', {
      palette: DEFAULT_PALETTE_ID,
      srgb: [254.6, 0.2, 16],
    });
    expect(t.app.store.get('swatches', swatch)).toMatchObject({ name: '#ff0010', srgb: [255, 0, 16] });
    expect(pollReason(t, 'palette.addSwatch', { palette: DEFAULT_PALETTE_ID, srgb: [0, 0, 300] })).toMatch(/0…255/);
    expect(pollReason(t, 'palette.addSwatch', { palette: 'pal_nope', srgb: [0, 0, 0] })).toBe('Unknown palette');
    expect(pollReason(t, 'palette.setSwatch', { swatch })).toBe('Nothing to change');
  });

  it('editing a swatch recolours (one record patch) and leaves the faces’ slots alone', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    paintFaces(t, id, [1], 4);
    await runValue(t, 'palette.setSwatch', { swatch: defaultSwatchId(4), srgb: [255, 0, 0], name: 'Pure red' });
    expect(t.app.store.query.swatchBySlot(DEFAULT_PALETTE_ID, 4)).toMatchObject({
      srgb: [255, 0, 0],
      name: 'Pure red',
    });
    expect(faceSlots(t, id)).toEqual([0, 4, 0, 0, 0, 0]);
    t.app.history.undo();
    expect(t.app.store.query.swatchBySlot(DEFAULT_PALETTE_ID, 4)?.srgb).toEqual([0xe0, 0x46, 0x46]);
  });

  it('removing the active swatch clears the active swatch', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    await runValue(t, 'palette.setActive', { swatch: defaultSwatchId(5) });
    expect(t.app.session.getState().model.activeSwatch).toBe(defaultSwatchId(5));
    await runValue(t, 'palette.removeSwatch', { swatch: defaultSwatchId(5) });
    expect(t.app.session.getState().model.activeSwatch).toBeNull();
    expect(pollReason(t, 'palette.setActive', { swatch: defaultSwatchId(5) })).toBe('Unknown swatch');
    await runValue(t, 'palette.setActive', { swatch: null });
  });
});

describe('palettes: create, rename, duplicate (variants)', () => {
  it('a variant keeps every slot (deleted ones included) with new ids and the same next slot', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    await runValue(t, 'palette.removeSwatch', { swatch: defaultSwatchId(15) });
    const { palette } = await runValue<{ palette: PaletteId }>(t, 'palette.duplicate', { palette: DEFAULT_PALETTE_ID });
    expect(palette).not.toBe(DEFAULT_PALETTE_ID);
    expect(t.app.store.get('palettes', palette)?.name).toBe('Ekza Default 16 variant');
    const source = t.app.store.query.swatchesOfPalette(DEFAULT_PALETTE_ID);
    const copy = t.app.store.query.swatchesOfPalette(palette);
    expect(copy.map((s) => [s.slot, s.srgb, s.name])).toEqual(source.map((s) => [s.slot, s.srgb, s.name]));
    expect(copy.every((s) => !source.some((o) => o.id === s.id))).toBe(true);
    expect(nextSlot(t.app.store, palette)).toBe(16);
    // the variant's colours change independently
    await runValue(t, 'palette.setSwatch', { swatch: copy[4]?.id, srgb: [0, 0, 255] });
    expect(t.app.store.query.swatchBySlot(DEFAULT_PALETTE_ID, 4)?.srgb).toEqual([0xe0, 0x46, 0x46]);
    expect(t.app.store.query.swatchBySlot(palette, 4)?.srgb).toEqual([0, 0, 255]);
  });

  it('creates an empty palette with a unique name and renames it', async () => {
    const t = await meshTestApp();
    const a = await runValue<{ palette: PaletteId }>(t, 'palette.create', { name: 'Team' });
    const b = await runValue<{ palette: PaletteId }>(t, 'palette.create', { name: 'Team' });
    expect([a, b].map((r) => t.app.store.get('palettes', r.palette)?.name)).toEqual(['Team', 'Team 2']);
    expect(t.app.store.query.swatchesOfPalette(a.palette)).toEqual([]);
    const first = await runValue<{ slot: number }>(t, 'palette.addSwatch', { palette: a.palette, srgb: [1, 1, 1] });
    expect(first.slot).toBe(0);
    await runValue(t, 'palette.rename', { palette: a.palette, name: '  Blue team ' });
    expect(t.app.store.get('palettes', a.palette)?.name).toBe('Blue team');
    expect(pollReason(t, 'palette.rename', { palette: a.palette, name: '   ' })).toBe('The palette needs a name');
  });
});

describe('palette.assign and Replace Swatch', () => {
  it('assigns a palette to the selected meshes and refuses imported meshes', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    const { palette } = await runValue<{ palette: PaletteId }>(t, 'palette.create', { name: 'Other' });
    selectObjects(t, [id]);
    await runValue(t, 'palette.assign', { palette });
    expect(t.app.store.get('meshes', id)?.palette).toBe(palette);
    t.app.store.transact({ label: 'Asset' }, (tx) =>
      tx.put('meshes', makeTestMesh('msh_Asset', { source: { asset: 'a'.repeat(64) as never, mesh: 0 } })),
    );
    expect(pollReason(t, 'palette.assign', { palette, meshes: ['msh_Asset'] })).toBe(
      'Imported meshes keep their materials',
    );
    expect(paintRefusal(t.app, ['msh_Asset' as MeshId])).toBe('Painting imported meshes arrives later');
    expect(paintRefusal(t.app, [id])).toBeNull();
    // the generator survives a palette change (not a component edit, §5.5 rule 9)
    expect(t.app.store.get('meshes', id)?.generator?.kind).toBe('cube');
  });

  it('replaceSwatch remaps one slot on every mesh using the palette, in one step', async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    const c = await cube(t);
    const { palette } = await runValue<{ palette: PaletteId }>(t, 'palette.create', { name: 'Other' });
    await runValue(t, 'palette.assign', { palette, meshes: [c] });
    paintFaces(t, a, [0, 2], 4);
    paintFaces(t, b, [5], 4);
    paintFaces(t, c, [0], 4);
    await runValue(t, 'palette.replaceSwatch', { palette: DEFAULT_PALETTE_ID, from: 4, to: 9 });
    expect(faceSlots(t, a)).toEqual([9, 0, 9, 0, 0, 0]);
    expect(faceSlots(t, b)).toEqual([0, 0, 0, 0, 0, 9]);
    expect(faceSlots(t, c)).toEqual([4, 0, 0, 0, 0, 0]);
    expect(t.app.history.peekUndo()?.label).toBe('Replace Swatch');
    // a component edit: the live parameters freeze (§5.5 rule 9)
    expect(t.app.store.get('meshes', a)?.generator).toBeNull();
    // one step: one undo restores both meshes
    t.app.history.undo();
    expect(faceSlots(t, a)).toEqual([4, 0, 4, 0, 0, 0]);
    expect(faceSlots(t, b)).toEqual([0, 0, 0, 0, 0, 4]);
    expect(counts(t, a)).toBe('8/12/6');
  });

  it('replaceSwatch polls: slots, the palette, a mesh that paints with it', async () => {
    const t = await meshTestApp();
    await runValue(t, 'palette.ensureDefault');
    expect(pollReason(t, 'palette.replaceSwatch', { palette: DEFAULT_PALETTE_ID, from: 1, to: 2 })).toBe(
      'No mesh paints with this palette',
    );
    expect(pollReason(t, 'palette.replaceSwatch', { palette: DEFAULT_PALETTE_ID, from: -1, to: 2 })).toMatch(/slot/);
    await cube(t);
    expect(pollReason(t, 'palette.replaceSwatch', { palette: DEFAULT_PALETTE_ID, from: 1, to: 2 })).toBeNull();
  });
});

describe('select.mesh.bySwatch', () => {
  it('selects the faces of the active swatch, hiliting the selected mesh in face mode', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    paintFaces(t, id, [1, 3], 6);
    expect(pollReason(t, 'select.mesh.bySwatch')).toBe('Selecting by swatch works in the Model workspace');
    t.app.session.setState({ workspace: 'model' });
    expect(pollReason(t, 'select.mesh.bySwatch')).toBe('Pick a swatch in the Palette first');
    await runValue(t, 'palette.setActive', { swatch: defaultSwatchId(6) });
    selectObjects(t, [id]);
    await runValue(t, 'select.mesh.bySwatch');
    const model = t.app.session.getState().model;
    expect(model.componentMode).toBe('face');
    expect(model.hilite).toEqual([id]);
    const sel = t.meshes.selectionFor(id, 'face');
    expect(sel === null ? [] : [...sel.faces.toArray()]).toEqual([1, 3]);
    // an explicit slot wins
    await runValue(t, 'select.mesh.bySwatch', { slot: 0 });
    const zero = t.meshes.selectionFor(id, 'face');
    expect(zero === null ? [] : [...zero.faces.toArray()]).toEqual([0, 2, 4, 5]);
  });

  it("uses the active swatch only on meshes of its palette (another palette's slot is another colour)", async () => {
    const t = await meshTestApp();
    const a = await cube(t);
    const b = await cube(t);
    paintFaces(t, a, [1], 6);
    paintFaces(t, b, [2], 6);
    const { palette: variant } = await runValue<{ palette: PaletteId }>(t, 'palette.duplicate', {
      palette: DEFAULT_PALETTE_ID,
    });
    selectObjects(t, [b]);
    await runValue(t, 'palette.assign', { palette: variant });
    t.app.session.setState({ workspace: 'model' });
    const foreign = t.app.store.query.swatchesOfPalette(variant).find((s) => s.slot === 6);
    await runValue(t, 'palette.setActive', { swatch: foreign?.id });
    expect(paintRefusal(t.app, [b], foreign)).toBeNull();
    expect(paintRefusal(t.app, [a, b], foreign)).toMatch(/^The active swatch is not in .+'s palette: assign .+ first$/);
    // Only `a` (the default palette): refused with the reason.
    selectObjects(t, [a]);
    expect(pollReason(t, 'select.mesh.bySwatch')).toMatch(/^The active swatch is not in/);
    // Both: `b` (the variant) selects its slot-6 face, `a` selects nothing.
    selectObjects(t, [a, b]);
    await runValue(t, 'select.mesh.bySwatch');
    const faces = (id: MeshId) => {
      const sel = t.meshes.selectionFor(id, 'face');
      return sel === null ? [] : [...sel.faces.toArray()];
    };
    expect(faces(b)).toEqual([2]);
    expect(faces(a)).toEqual([]);
    // An explicit slot is the caller's choice on every mesh.
    await runValue(t, 'select.mesh.bySwatch', { slot: 6 });
    expect(faces(a)).toEqual([1]);
    expect(faces(b)).toEqual([2]);
  });

  it('[READY.b10] records one "Select" step in Model', async () => {
    const t = await meshTestApp();
    const id = await cube(t);
    paintFaces(t, id, [2], 6);
    t.app.session.setState({ workspace: 'model' });
    selectObjects(t, [id]);
    await runValue(t, 'select.mesh.bySwatch', { slot: 6 });
    expect(t.app.history.peekUndo()?.label).toBe('Select');
  });
});

describe('Assign Colour › Active Swatch (mesh.paint without a slot, §6.1; B13 hand-over M6A-B13-18)', () => {
  it('paints with the active swatch, refuses a swatch of another palette, and paints slot 0 without one', async () => {
    const t = await meshTestApp();
    await runValue(t, 'workspace.set', { workspace: 'model' });
    const id = await cube(t);
    selectObjects(t, [id]);
    await runValue(t, 'select.mode', { mode: 'face' });
    await runValue(t, 'select.components', { mesh: id, kind: 'face', indices: [0], mode: 'replace' });
    await runValue(t, 'palette.setActive', { swatch: defaultSwatchId(4) });
    await runValue(t, 'mesh.paint', { kind: 'face' });
    expect(faceSlots(t, id)[0]).toBe(4);
    expect(t.app.session.getState().lastRun?.args).toMatchObject({ slot: 4 });
    // A swatch of another palette (a duplicate of the default one) is refused with the reason.
    const { palette: other } = await runValue<{ palette: PaletteId }>(t, 'palette.duplicate', {
      palette: DEFAULT_PALETTE_ID,
    });
    const foreign = t.app.store.query.swatchesOfPalette(other).find((s) => s.slot === 6);
    if (foreign === undefined) throw new Error('no swatch in the duplicate');
    await runValue(t, 'palette.setActive', { swatch: foreign.id });
    const refused = await t.app.runUntyped('mesh.paint', { kind: 'face' });
    expect(refused).toMatchObject({ status: 'failed', error: { code: 'op-refused' } });
    expect(refused.status === 'failed' ? refused.error.message : '').toMatch(/not in .*palette/);
    expect(faceSlots(t, id)[0]).toBe(4);
    // No active swatch: the descriptor's default slot.
    await runValue(t, 'palette.setActive', { swatch: null });
    await runValue(t, 'mesh.paint', { kind: 'face' });
    expect(faceSlots(t, id)[0]).toBe(0);
  });
});
