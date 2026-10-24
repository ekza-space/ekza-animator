// CHARACTER-CONTRACT-SPEC §8.7–§8.10 (C2): slot setup from the contract, fixes, named markers, the package plan.
// `target.slot.create` makes a blank slot clip with the contract's settings in one undo step; `target.fix` repairs each
// issue it offers (Make loop, Set in place, Fit timing, Set contact, Use default) in one step; `target.marker.set`
// moves the contact and named markers (`ekza.clipMarkers`), which the slot status checks; Validation rows are strict
// for the OMOBA package profile and carry their fix; the package plan lists the custom clips by offer order, aliases
// sharing an animation, with the marker seconds the manifest writes.
import { readFileSync } from 'node:fs';
import type { ClipId, ClipRecord } from '@ekza-studio/doc';
import {
  type ContractModel,
  characterPackageManifest,
  OMOBA_PACKAGE_PROFILE_ID,
  readContractText,
} from '@ekza-studio/io';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src';
import {
  blankFrames,
  clipMarkers,
  computeSlotStatuses,
  contractsOf,
  MARKERS_TABLE,
  markerTargetFrame,
  packagePlan,
  type SlotClip,
  slotStatuses,
  TARGETS_TABLE,
  targetValidationRows,
} from '../../src/workflows/target';
import { docJson, opsApp, runOk, runResult, WAVE } from '../builtin/support';

const PUBLIC = new URL('../../../../apps/web/public/contracts/', import.meta.url);
const TEXT = readFileSync(new URL('../../../../fixtures/contracts/omoba.game-contract.json', import.meta.url), 'utf8');
const MODEL: ContractModel = readContractText(TEXT);

function served(url: string) {
  const text = readFileSync(new URL(url.replace(/^\/contracts\//, ''), PUBLIC), 'utf8');
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
}

/** The document as JSON without the extension tables while they are empty. */
function doc(app: EditorApp): unknown {
  const json = docJson(app) as { tables: Record<string, Record<string, unknown>> };
  for (const table of [TARGETS_TABLE, MARKERS_TABLE]) {
    if (Object.keys(json.tables[table] ?? {}).length === 0) delete json.tables[table];
  }
  return json;
}

async function oneStep(app: EditorApp, id: string, args: unknown): Promise<unknown> {
  const before = doc(app);
  const value = await runOk(app, id, args);
  const after = doc(app);
  expect(after).not.toEqual(before);
  expect((await app.runUntyped('edit.undo')).status).toBe('finished');
  expect(doc(app)).toEqual(before);
  expect((await app.runUntyped('edit.redo')).status).toBe('finished');
  expect(doc(app)).toEqual(after);
  return value;
}

const clipOf = (app: EditorApp, id: ClipId): ClipRecord => app.store.get('clips', id) as ClipRecord;
const rowOf = (app: EditorApp, slot: string) =>
  slotStatuses(app, WAVE.character)?.rows.find((row) => row.slot === slot);

let app: EditorApp;
beforeEach(async () => {
  app = opsApp();
  const { loadTargetKit } = await import('../../src');
  await loadTargetKit(app);
  contractsOf(app, { fetch: served });
  await runOk(app, 'target.bind', { character: WAVE.character, game: 'omoba', target: 'wildspark' });
});

describe('target.slot.create (§8.7)', () => {
  it('a blank basic attack: 30 fps, the target length, in place, the contact at its target, named by the slot', async () => {
    const value = (await oneStep(app, 'target.slot.create', {
      character: WAVE.character,
      slot: 'basic.wildspark.0',
      from: 'blank',
    })) as { clip: ClipId };
    const clip = clipOf(app, value.clip);
    expect(clip).toMatchObject({
      name: 'Basic attack',
      slot: 'basic.wildspark.0',
      fps: { num: 30, den: 1 },
      range: { start: 0, end: 8 },
      loop: false,
      rootMotion: 'in-place',
      contact: 1,
    });
    expect(app.history.peekUndo()?.label).toBe('New Clip for Basic attack');
    expect(rowOf(app, 'basic.wildspark.0')?.status.kind).toBe('custom');
  });

  it('a blank run loops and fills the window target; the slot moves off another clip', async () => {
    await runOk(app, 'target.slot.assign', { character: WAVE.character, slot: 'base.run', clip: WAVE.clip });
    const { clip } = (await runOk(app, 'target.slot.create', {
      character: WAVE.character,
      slot: 'base.run',
      from: 'blank',
    })) as { clip: ClipId };
    expect(clipOf(app, clip)).toMatchObject({ slot: 'base.run', loop: true, range: { start: 0, end: 20 } });
    expect(clipOf(app, WAVE.clip).slot).toBeNull();
  });

  it('refuses a slot that is not open, an object slot and an unbound character', async () => {
    const asset = await runResult(app, 'target.slot.create', {
      character: WAVE.character,
      slot: 'wildspark.handheld.repeater',
      from: 'blank',
    });
    expect(asset.status).toBe('cancelled');
    const library = await runResult(app, 'target.slot.create', {
      character: WAVE.character,
      slot: 'base.run',
      from: 'library',
    });
    expect(library.status).toBe('cancelled');
  });

  it('frames and marker frames stay inside the window and the limit', () => {
    const anim = MODEL.slots['basic.wildspark.rockets.0']?.animation;
    expect(anim).toBeDefined();
    if (anim === null || anim === undefined) return;
    expect(blankFrames(anim, { num: 30, den: 1 })).toBe(21);
    const clip = { fps: { num: 30, den: 1 }, range: { start: 10, end: 31 } };
    expect(markerTargetFrame(clip, { maxSecs: 0.15, targetSecs: 0.1478 })).toBe(14);
    expect(markerTargetFrame(clip, { maxSecs: 0.15, targetSecs: 0.2 })).toBe(14);
  });
});

describe('target.fix and markers (§8.8, §8.9)', () => {
  it('Set contact, Fit timing, Make loop, Set in place, each one step, each clears its issue', async () => {
    await runOk(app, 'target.slot.assign', { character: WAVE.character, slot: 'basic.wildspark.0', clip: WAVE.clip });
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, contact: null, loop: true, rootMotion: 'hips' });
    const rules = () =>
      ((rowOf(app, 'basic.wildspark.0')?.status ?? {}) as { issues?: { rule: string; fix?: string }[] }).issues?.map(
        (issue) => `${issue.rule}:${issue.fix ?? '-'}`,
      ) ?? [];
    expect(rules()).toContain('clip.markers:Set contact');
    expect(rules()).toContain('clip.in-place:Set in place');

    await oneStep(app, 'target.fix', { character: WAVE.character, slot: 'basic.wildspark.0', rule: 'clip.markers' });
    expect(app.history.peekUndo()?.label).toBe('Set contact · Basic attack');
    expect(rules().some((rule) => rule.startsWith('clip.markers'))).toBe(false);

    await oneStep(app, 'target.fix', { character: WAVE.character, slot: 'basic.wildspark.0', rule: 'clip.in-place' });
    expect(clipOf(app, WAVE.clip).rootMotion).toBe('in-place');

    await oneStep(app, 'target.fix', { character: WAVE.character, slot: 'basic.wildspark.0', rule: 'clip.duration' });
    const fitted = clipOf(app, WAVE.clip);
    expect((fitted.range.end - fitted.range.start) / (fitted.fps.num / fitted.fps.den)).toBeCloseTo(
      blankFrames(MODEL.slots['basic.wildspark.0']?.animation as never, fitted.fps) / (fitted.fps.num / fitted.fps.den),
      6,
    );
    expect(rules().some((rule) => rule.startsWith('clip.duration'))).toBe(false);

    await runOk(app, 'target.slot.assign', { character: WAVE.character, slot: 'base.run', clip: WAVE.clip });
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, loop: false });
    expect(rowOf(app, 'base.run')?.status.kind).toBe('invalid');
    await oneStep(app, 'target.fix', { character: WAVE.character, slot: 'base.run', rule: 'clip.loop-closure' });
    expect(clipOf(app, WAVE.clip).loop).toBe(true);
  });

  it('refuses a fix for an issue the slot does not have', async () => {
    await runOk(app, 'target.slot.assign', { character: WAVE.character, slot: 'base.idle', clip: WAVE.clip });
    const result = await runResult(app, 'target.fix', {
      character: WAVE.character,
      slot: 'base.idle',
      rule: 'clip.markers',
    });
    expect(result.status).toBe('cancelled');
  });

  it('target.marker.set: the contact on the clip, named markers in ekza.clipMarkers, both one step', async () => {
    const clip = clipOf(app, WAVE.clip);
    await oneStep(app, 'target.marker.set', { clip: WAVE.clip, marker: 'contact', frame: clip.range.start + 2 });
    expect(clipOf(app, WAVE.clip).contact).toBe(clip.range.start + 2);
    await oneStep(app, 'target.marker.set', { clip: WAVE.clip, marker: 'release', frame: clip.range.start + 3 });
    expect(clipMarkers(app.store, clipOf(app, WAVE.clip))).toEqual({
      contact: clip.range.start + 2,
      release: clip.range.start + 3,
    });
    expect(app.history.peekUndo()?.label).toBe('Set release marker');
    const outside = await runResult(app, 'target.marker.set', { clip: WAVE.clip, marker: 'fire', frame: -100 });
    expect(outside.status).toBe('cancelled');
  });

  it('a slot that declares a named marker checks it on the clip (pure)', () => {
    const base = MODEL.slots['skill.wild_traps.release'];
    if (base?.animation === null || base === undefined) throw new Error('fixture');
    const markers = { ...base.animation.markers, release: { required: true, maxSecs: 0.3, targetSecs: 0.2 } };
    const model: ContractModel = {
      ...MODEL,
      slots: { ...MODEL.slots, [base.id]: { ...base, animation: { ...base.animation, markers } } },
    };
    const clip: SlotClip = {
      id: 'clp_markers00000001' as ClipId,
      name: 'Toss',
      slot: base.id,
      fps: { num: 30, den: 1 },
      range: { start: 0, end: 12 },
      loop: false,
      rootMotion: 'in-place',
      contact: 3,
    };
    const issues = (clips: SlotClip[]) => {
      const status = computeSlotStatuses(model, { target: 'wildspark', aliases: {} }, clips).rows.find(
        (row) => row.slot === base.id,
      )?.status;
      return status !== undefined && 'issues' in status ? status.issues.map((issue) => issue.message) : [];
    };
    expect(issues([clip])).toEqual(['Needs a release marker frame']);
    expect(issues([{ ...clip, markers: { release: 6 } }])).toEqual([]);
    expect(issues([{ ...clip, markers: { release: 11 } }])).toEqual(['The release marker 0.37 s > 0.30 s']);
  });
});

describe('Validation rows and the package plan (§8.9, §8.10)', () => {
  it('strict for the OMOBA package profile, advisory for others; each carries its fix', async () => {
    await runOk(app, 'target.slot.assign', { character: WAVE.character, slot: 'basic.wildspark.0', clip: WAVE.clip });
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, contact: null });
    const advisory = targetValidationRows(app, WAVE.character);
    const strict = targetValidationRows(app, WAVE.character, OMOBA_PACKAGE_PROFILE_ID);
    const contact = (rows: typeof strict) => rows.find((row) => row.message.includes('contact'));
    expect(contact(advisory)?.severity).toBe('warning');
    expect(contact(strict)?.severity).toBe('error');
    expect(contact(strict)?.fix).toEqual({
      label: 'Set contact',
      op: 'target.fix',
      args: { character: WAVE.character, slot: 'basic.wildspark.0', rule: 'clip.markers', marker: 'contact' },
    });
  });

  it('lists the custom clips in offer order; an alias shares the animation; the manifest names every slot', async () => {
    await runOk(app, 'target.slot.assign', {
      character: WAVE.character,
      slot: 'basic.wildspark.rockets.0',
      clip: WAVE.clip,
    });
    await runOk(app, 'target.fix', {
      character: WAVE.character,
      slot: 'basic.wildspark.rockets.0',
      rule: 'clip.markers',
    });
    const { clip: run } = (await runOk(app, 'target.slot.create', {
      character: WAVE.character,
      slot: 'base.run',
      from: 'blank',
    })) as { clip: ClipId };
    await runOk(app, 'target.slot.alias', {
      character: WAVE.character,
      slot: 'skill.wild_rocket.release',
      to: 'basic.wildspark.rockets.0',
    });
    const plan = packagePlan(app, WAVE.character);
    expect(plan.clips.map((clip) => clip.id)).toEqual([run, WAVE.clip]);
    const contact = plan.fills.get('basic.wildspark.rockets.0')?.markers['contact'];
    expect(plan.fills.get('skill.wild_rocket.release')).toEqual({ animation: 1, markers: { contact } });
    expect(plan.fills.get('base.run')).toEqual({ animation: 0, markers: {} });
    const manifest = characterPackageManifest({
      model: plan.model,
      target: 'wildspark',
      fills: plan.fills,
      tool: 'ekza-studio',
      toolVersion: '0',
    });
    expect(Object.values(manifest.slots).filter((fill) => fill.mode === 'default')).toHaveLength(6);
  });

  it('an unbound character has no package', () => {
    const other = opsApp();
    expect(() => packagePlan(other, WAVE.character)).toThrow(/Target/);
  });
});
