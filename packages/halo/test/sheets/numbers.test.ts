// Numbers (STUDIO-TOUCH-SPEC §6.6, §10.1, P14; AS-ST-19's shape): the sections per noun on headless content, and every
// edit is one operator run that lands — a channel through `channel.setValues` with Pro's number and sign (degrees
// shown, radians stored), a mesh's transform, pivot and shape inputs, a reference's settings, a joint's rest values
// and the active animation's settings.
import type { ControlId } from '@ekza-studio/doc';
import { type EditorApp, toDisplayValue } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { type NumbersSection, numbersSections } from '../../src/sheets/numbers/model';
import type { Noun } from '../../src/verbs/nouns';
import { everyOperator, polybotApp, runOk } from '../support';

const noun = (kind: Noun['kind'], ids: readonly string[], character: string | null = null): Noun => ({
  kind,
  id: ids.at(-1) ?? null,
  ids,
  label: kind,
  count: ids.length,
  character,
});

function field(sections: readonly NumbersSection[], section: string, id: string) {
  const found = sections.find((s) => s.id === section)?.fields.find((f) => f.id.endsWith(id));
  if (found === undefined) throw new Error(`no field ${section}/${id}`);
  return found;
}

async function run(app: EditorApp, call: { readonly op: string; readonly args?: unknown } | null): Promise<void> {
  if (call === null) throw new Error('read-only field');
  await runOk(app, call.op, call.args);
}

describe('Numbers (§6.6)', () => {
  it('shows a control’s channels with Pro’s numbers and writes them through channel.setValues', async () => {
    const { app, character } = await polybotApp();
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    const control = app.store
      .list('controls')
      .find((c) => c.deleted === null && c.key.startsWith('fk.') && c.keyable.r[0]) as { id: ControlId; name: string };
    const sections = numbersSections(app, noun('control', [control.id], character));
    expect(sections.map((s) => s.id)).toContain('channels');
    const turnX = field(sections, 'channels', '/rx');
    expect(turnX).toMatchObject({ label: 'Turn X', pro: 'Rotate X', unit: '°' });
    await run(app, turnX.write?.(30) ?? null);
    expect(toDisplayValue('rx', app.evaluation.channelValue(control.id, 'rx'), 'angle')).toBeCloseTo(30, 6);
    const again = field(numbersSections(app, noun('control', [control.id], character)), 'channels', '/rx');
    expect(again.value).toBeCloseTo(30, 3);
    const reset = again.menu?.find((item) => item.label === 'Reset to default');
    await run(app, reset ?? null);
    expect(app.evaluation.channelValue(control.id, 'rx')).toBeCloseTo(0, 9);
    expect(again.menu?.map((item) => item.label)).toEqual(['Key this channel', 'Lock', 'Reset to default']);
  }, 60_000);

  it('edits a mesh’s transform, pivot, shape inputs and name, one run each', async () => {
    const app = await everyOperator();
    await runOk(app, 'workspace.set', { workspace: 'model' });
    const { mesh } = await runOk<{ mesh: string }>(app, 'mesh.create.cube');
    let sections = numbersSections(app, noun('mesh', [mesh]));
    expect(sections.map((s) => s.id)).toEqual(['transform', 'pivot', 'shapeInputs', 'mesh']);
    await run(app, field(sections, 'transform', 'tY').write?.(0.5) ?? null);
    await run(app, field(sections, 'transform', 'rZ').write?.(90) ?? null);
    sections = numbersSections(app, noun('mesh', [mesh]));
    expect(field(sections, 'transform', 'tY').value).toBeCloseTo(0.5, 6);
    expect(field(sections, 'transform', 'rZ').value).toBeCloseTo(90, 3);
    await run(app, field(sections, 'pivot', 'pivotX').write?.(0.25) ?? null);
    const shape = sections.find((s) => s.id === 'shapeInputs')?.fields[0];
    expect(shape?.kind).toBe('number');
    await run(app, shape?.write?.(Number(shape.value) + 1) ?? null);
    await run(app, field(sections, 'mesh', 'name').write?.('Box') ?? null);
    sections = numbersSections(app, noun('mesh', [mesh]));
    expect(field(sections, 'pivot', 'pivotX').value).toBeCloseTo(0.25, 6);
    expect(field(sections, 'mesh', 'name').value).toBe('Box');
    expect(app.history.peekUndo()?.label).toBeDefined();
  }, 60_000);

  it('shows the active animation’s settings in Animate and the character with About this character', async () => {
    const { app, character } = await polybotApp();
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    await runOk(app, 'clip.new', { character, name: 'wave', range: { start: 0, end: 24 } });
    const sections = numbersSections(app, noun('character', [character], character));
    expect(sections.map((s) => s.id)).toEqual(['character', 'animation']);
    expect(sections[0]?.link).toEqual({ label: 'About this character ›', sheet: 'about' });
    await run(app, field(sections, 'animation', 'loop').write?.(true) ?? null);
    await run(app, field(sections, 'animation', 'end').write?.(36) ?? null);
    const clip = numbersSections(app, noun('character', [character], character)).find((s) => s.id === 'animation');
    expect(clip?.fields.find((f) => f.id === 'loop')?.value).toBe(true);
    expect(clip?.fields.find((f) => f.id === 'end')?.value).toBe(36);
  }, 60_000);

  it('is empty for nothing selected without a character', async () => {
    const app = await everyOperator();
    expect(numbersSections(app, null)).toEqual([]);
  });
});
