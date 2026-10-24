// CHARACTER-CONTRACT-SPEC §8.1–§8.3, §8.16 (C1): the target chunk. The pure slot status function over the bundled
// OMOBA contract (custom, invalid, default, missing, fixed, aliases, extras, an asset slot); the target operators,
// each one undo step (bind, unbind, update, assign, clear, alias); the open vocabulary of `clip.setSettings` and
// `library.useClip`'s slot (one clip per contract slot per character; the chunk loads on demand); the `animation`
// Validation rows; the target surviving a snapshot round-trip and reading its pinned contract without any fetch.
import { readFileSync } from 'node:fs';
import type { ClipId, ClipRecord } from '@ekza-studio/doc';
import { type ContractModel, type ContractSlotSpec, readContractText } from '@ekza-studio/io';
import { beforeEach, describe, expect, it } from 'vitest';
import { type EditorApp, isTargetSlotId, loadTargetKit } from '../../src';
import { createFakeEditorApp } from '../../src/testing';
import {
  computeSlotStatuses,
  contractsOf,
  type SlotClip,
  slotStatuses,
  TARGETS_TABLE,
  targetOf,
  targetValidationRows,
} from '../../src/workflows/target';
import { setTargetSlotCheck, targetSlotsLoaded } from '../../src/workflows/targetSlots';
import { docJson, humanoidSkeleton, opsApp, runOk, runResult, WAVE } from '../builtin/support';

/** The document as JSON, without an empty `ekza.targets` table (the store keeps a table once declared). */
function doc(app: EditorApp): unknown {
  const json = docJson(app) as { tables: Record<string, Record<string, unknown>> };
  if (Object.keys(json.tables[TARGETS_TABLE] ?? {}).length === 0) delete json.tables[TARGETS_TABLE];
  return json;
}

/** One run = one history step that undoes and redoes exactly (§6.3, `expectUndoRedoExact` with `doc`). */
async function expectUndoRedoExact(app: EditorApp, id: string, args?: unknown): Promise<{ readonly after: unknown }> {
  const before = doc(app);
  const steps = app.history.peekUndo()?.id ?? null;
  await runOk(app, id, args);
  const after = doc(app);
  expect(after).not.toEqual(before);
  expect(app.history.peekUndo()?.id).not.toBe(steps);
  expect((await app.runUntyped('edit.undo')).status).toBe('finished');
  expect(doc(app)).toEqual(before);
  expect((await app.runUntyped('edit.redo')).status).toBe('finished');
  expect(doc(app)).toEqual(after);
  return { after };
}

const PUBLIC = new URL('../../../../apps/web/public/contracts/', import.meta.url);
const TEXT = readFileSync(
  new URL('../../../../fixtures/contracts/omoba.character-contract.v1.json', import.meta.url),
  'utf8',
);
const MODEL: ContractModel = readContractText(TEXT);

interface Served {
  readonly requests: string[];
  tamper: boolean;
}

function servedFetch(served: Served) {
  return (url: string) => {
    served.requests.push(url);
    let text: string;
    try {
      text = readFileSync(new URL(url.replace(/^\/contracts\//, ''), PUBLIC), 'utf8');
    } catch {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.reject(new Error('404')) });
    }
    if (served.tamper && !url.endsWith('index.json')) text = text.replace('"Idle"', '"Idol"');
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(text) });
  };
}

const ZERO = { start: 0, end: 1 };
const FPS30 = { num: 30, den: 1 };
let next = 0;
function clip(fields: Partial<SlotClip>): SlotClip {
  next++;
  return {
    id: `clp_test${String(next).padStart(12, '0')}` as ClipId,
    name: `clip ${next}`,
    slot: null,
    fps: FPS30,
    range: ZERO,
    loop: false,
    rootMotion: 'in-place',
    contact: null,
    ...fields,
  };
}

const WILDSPARK = { gameCharacter: 'wildspark', aliases: {} };

describe('computeSlotStatuses (pure)', () => {
  it('an empty Wildspark: nine game-default rows in checklist order, no extras', () => {
    const statuses = computeSlotStatuses(MODEL, WILDSPARK, []);
    expect(statuses.rows.map((row) => [row.slot, row.section, row.key, row.status.kind])).toEqual([
      ['base.idle', 'Base', null, 'default'],
      ['base.run', 'Base', null, 'default'],
      ['base.death', 'Base', null, 'default'],
      ['basic.wildspark.0', 'Basic attack', null, 'default'],
      ['basic.wildspark.rockets.0', 'Basic attack', null, 'default'],
      ['skill.wild_switch.release', 'Switchfire', 'Q', 'default'],
      ['skill.wild_zap.release', 'Shockline', 'W', 'default'],
      ['skill.wild_traps.release', 'Snapline', 'E', 'default'],
      ['skill.wild_rocket.release', 'Last Spark', 'R', 'default'],
    ]);
    expect(statuses.counts).toEqual({ custom: 0, invalid: 0, default: 9, missing: 0, fixed: 0 });
    expect(statuses.rows[1]?.timing).toBe('game default · ↻ 0.67 s');
    expect(statuses.rows[6]?.timing).toBe('game default · 0.57 s · contact 0.04 s');
    expect(statuses.rows[6]?.target).toEqual({ secs: 0.5682, contactSecs: 0.0379 });
    expect(statuses.extras).toEqual([]);
  });

  it('custom, invalid with the contract’s reasons, aliases and extras', () => {
    const run = clip({ slot: 'base.run', loop: true, range: { start: 0, end: 20 } });
    const idle = clip({ slot: 'base.idle', loop: false, range: { start: 0, end: 75 } });
    const basic = clip({ slot: 'basic.wildspark.0', range: { start: 0, end: 13 }, contact: 6 });
    const rocket = clip({
      slot: 'basic.wildspark.rockets.0',
      range: { start: 0, end: 20 },
      contact: 4,
      rootMotion: 'hips',
    });
    const wave = clip({ slot: 'wave' });
    const loose = clip({});
    const rom = clip({ slot: 'base.death', source: { kind: 'test', generator: 'rom', version: 1 } });
    const statuses = computeSlotStatuses(
      MODEL,
      { gameCharacter: 'wildspark', aliases: { 'skill.wild_rocket.release': 'basic.wildspark.rockets.0' } },
      [run, idle, basic, rocket, wave, loose, rom],
    );
    const row = (slot: string) => statuses.rows.find((candidate) => candidate.slot === slot);
    expect(row('base.run')?.status).toEqual({ kind: 'custom', clip: run.id, via: 'own', from: 'base.run', issues: [] });
    expect(row('base.run')?.timing).toBe('↻ 0.67 s · in place');
    expect(row('base.idle')?.status).toMatchObject({
      kind: 'invalid',
      issues: [{ rule: 'clip.loop-closure', severity: 'error', message: 'The game loops it: turn Loop on' }],
    });
    // 13 frames at 30 fps = 0.43 s (in the window); contact 0.20 s > 0.15 s; longer than the 0.44 s interval? no
    expect(row('basic.wildspark.0')?.status).toMatchObject({
      kind: 'invalid',
      issues: [{ rule: 'clip.contact', severity: 'error', message: 'Contact 0.20 s > 0.15 s' }],
    });
    // the rocket basic: in place is a warning only; 0.67 s is longer than the 0.44 s basic interval (warning)
    expect(row('basic.wildspark.rockets.0')?.status.kind).toBe('custom');
    expect(row('basic.wildspark.rockets.0')?.status).toMatchObject({
      issues: [
        { rule: 'clip.in-place', severity: 'warning' },
        { rule: 'clip.basic-interval', severity: 'warning' },
      ],
    });
    expect(row('skill.wild_rocket.release')?.status).toMatchObject({
      kind: 'custom',
      clip: rocket.id,
      via: 'alias',
      from: 'basic.wildspark.rockets.0',
    });
    // the test clip neither fills base.death nor counts as an extra
    expect(row('base.death')?.status.kind).toBe('default');
    expect(statuses.extras).toEqual([wave.id, loose.id]);
    expect(statuses.counts).toEqual({ custom: 3, invalid: 2, default: 4, missing: 0, fixed: 0 });
  });

  it('a wind-up is fixed until its contract opens it; a fill there is invalid', () => {
    const empty = computeSlotStatuses(MODEL, { gameCharacter: 'dawnweaver', aliases: {} }, []);
    const windup = empty.rows.find((row) => row.slot === 'skill.dawn_ray.windup');
    expect(windup?.status).toEqual({ kind: 'fixed' });
    expect(windup?.customizableFrom).toBe('1.1');
    expect(empty.counts.fixed).toBe(1);
    const filled = computeSlotStatuses(MODEL, { gameCharacter: 'dawnweaver', aliases: {} }, [
      clip({ slot: 'skill.dawn_ray.windup', range: { start: 0, end: 24 } }),
    ]);
    expect(filled.rows.find((row) => row.slot === 'skill.dawn_ray.windup')?.status).toMatchObject({
      kind: 'invalid',
      issues: [{ rule: 'slot.not-open', message: 'Custom fills open with contract 1.1' }],
    });
  });

  it('generic over slot kinds: an asset slot shows its default (no filler yet), a required one without a default is missing', () => {
    const idle = MODEL.slots['base.idle'] as ContractSlotSpec;
    const run = MODEL.slots['base.run'] as ContractSlotSpec;
    const asset: ContractSlotSpec = { ...idle, id: 'asset.weapon', kind: 'asset', animation: null };
    const required: ContractSlotSpec = { ...run, required: true, default: null };
    const model: ContractModel = {
      ...MODEL,
      slots: { ...MODEL.slots, 'asset.weapon': { ...asset, label: 'Weapon' }, 'base.run': required },
      characters: [
        {
          id: 'hero',
          name: 'Hero',
          kind: 'character',
          subtitle: null,
          requirementId: 'character.hero',
          sections: [{ id: 'base', label: 'Base', key: null, slots: ['base.run', 'asset.weapon'] }],
          slots: ['base.run', 'asset.weapon'],
        },
      ],
    };
    const statuses = computeSlotStatuses(model, { gameCharacter: 'hero', aliases: {} }, [
      clip({ slot: 'asset.weapon' }),
    ]);
    expect(statuses.rows.map((row) => [row.slot, row.kind, row.status.kind])).toEqual([
      ['base.run', 'animation', 'missing'],
      ['asset.weapon', 'asset', 'default'],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('target operators and the open vocabulary', () => {
  let app: ReturnType<typeof opsApp>;
  let served: Served;
  const character = WAVE.character;

  beforeEach(async () => {
    app = opsApp();
    served = { requests: [], tamper: false };
    contractsOf(app, { fetch: servedFetch(served) });
  });

  const record = (id: ClipId): ClipRecord => app.store.get('clips', id) as ClipRecord;
  const newClip = async (name: string): Promise<ClipId> =>
    ((await runOk(app, 'clip.new', { character, name })) as { clip: ClipId }).clip;

  it('a contract slot on a clip without a target is refused, and the chunk loads on demand', async () => {
    setTargetSlotCheck(null);
    expect(targetSlotsLoaded()).toBe(false);
    expect(isTargetSlotId('base.run')).toBe(true);
    expect(isTargetSlotId('walk')).toBe(false);
    const result = await runResult(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'base.run' });
    expect(result).toMatchObject({
      status: 'cancelled',
      reason: "'base.run' is a target slot: set a target for the character first",
    });
    expect(targetSlotsLoaded()).toBe(true);
    // the vocabulary-v1 slots are unchanged
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'wave' });
    expect((await runResult(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'flying' })).status).toBe('cancelled');
  });

  it('target.bind pins the bundled live revision (one undo step); the runner loads the chunk', async () => {
    const { after } = await expectUndoRedoExact(app, 'target.bind', {
      character,
      game: 'omoba',
      gameCharacter: 'wildspark',
    });
    expect(after).toBeDefined();
    const target = targetOf(app.store, character);
    expect(target?.gameCharacter).toBe('wildspark');
    expect(target?.contract.revision).toBe(MODEL.revision);
    expect(target?.contract.schema).toBe('omoba.character-contract.v1');
    expect(readContractText(target?.document ?? '').revision).toBe(MODEL.revision);
    expect(app.history.peekUndo()?.label).toBe('Set Target');
    expect(served.requests).toEqual(['/contracts/omoba/index.json', `/contracts/omoba/${MODEL.revision}.json`]);
    const statuses = slotStatuses(app, character);
    expect(statuses?.counts.default).toBe(9);
    // the wave clip (no slot) is an extra
    expect(statuses?.extras).toEqual([WAVE.clip]);
    expect((await runResult(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'nobody' })).status).toBe(
      'failed',
    );
  });

  it('assign moves a slot, clear empties it, alias reuses a clip, each one undo step', async () => {
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'wildspark' });
    const other = await newClip('Run 2');
    await expectUndoRedoExact(app, 'target.slot.assign', { character, slot: 'base.run', clip: WAVE.clip });
    expect(record(WAVE.clip).slot).toBe('base.run');
    expect(app.history.peekUndo()?.label).toBe('Use Clip for Run (all movement)');
    // assigning the slot to another clip moves it off the first one, in one step
    await expectUndoRedoExact(app, 'target.slot.assign', { character, slot: 'base.run', clip: other });
    expect(record(other).slot).toBe('base.run');
    expect(record(WAVE.clip).slot).toBeNull();
    // the open vocabulary: setSettings refuses a second holder, a slot of another hero and a closed slot
    const two = await runResult(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'base.run' });
    expect(two).toMatchObject({
      status: 'cancelled',
      reason: "'Run 2' already fills Run (all movement): one clip per slot",
    });
    expect(await runResult(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'basic.warden.0' })).toMatchObject({
      reason: "'basic.warden.0' is not a slot of Wildspark",
    });
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, slot: 'basic.wildspark.rockets.0' });
    // alias: Last Spark reuses the rocket basic's clip
    await expectUndoRedoExact(app, 'target.slot.alias', {
      character,
      slot: 'skill.wild_rocket.release',
      to: 'basic.wildspark.rockets.0',
    });
    expect(targetOf(app.store, character)?.aliases).toEqual({
      'skill.wild_rocket.release': 'basic.wildspark.rockets.0',
    });
    const aliased = slotStatuses(app, character)?.rows.find((row) => row.slot === 'skill.wild_rocket.release');
    expect(aliased?.status).toMatchObject({ clip: WAVE.clip, via: 'alias' });
    // clear: the slot plays the game default again; the clip stays without its slot
    await expectUndoRedoExact(app, 'target.slot.clear', { character, slot: 'base.run' });
    expect(record(other).slot).toBeNull();
    expect(record(other).deleted).toBeNull();
    expect((await runResult(app, 'target.slot.clear', { character, slot: 'base.run' })).status).toBe('cancelled');
    // clearing an aliased slot drops the alias
    await runOk(app, 'target.slot.clear', { character, slot: 'skill.wild_rocket.release' });
    expect(targetOf(app.store, character)?.aliases).toEqual({});
    // the wave clip still fills the rocket basic, without the contact frame it needs
    expect(slotStatuses(app, character)?.counts).toEqual({ custom: 0, invalid: 1, default: 8, missing: 0, fixed: 0 });
  });

  it('a wind-up slot is refused while its contract keeps it closed', async () => {
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'dawnweaver' });
    const result = await runResult(app, 'target.slot.assign', {
      character,
      slot: 'skill.dawn_ray.windup',
      clip: WAVE.clip,
    });
    expect(result).toMatchObject({ status: 'cancelled', reason: 'Horizon Ray (R) — wind-up opens with contract 1.1' });
  });

  it('unbind and update are one undo step each; clips keep their slots; update never edits clips', async () => {
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'any' });
    await runOk(app, 'target.slot.assign', { character, slot: 'base.idle', clip: WAVE.clip });
    expect((await runResult(app, 'target.update', { character })).status).toBe('failed');
    await expectUndoRedoExact(app, 'target.unbind', { character });
    expect(targetOf(app.store, character)).toBeUndefined();
    expect(record(WAVE.clip).slot).toBe('base.idle');
    expect(slotStatuses(app, character)).toBeNull();
    // rebinding brings the clips back as fills
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'warden' });
    expect(slotStatuses(app, character)?.rows[0]?.status).toMatchObject({
      kind: 'custom',
      clip: WAVE.clip,
      via: 'own',
    });
  });

  it('Validation rows of area animation: one per issue, warnings in C1', async () => {
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'wildspark' });
    await runOk(app, 'target.slot.assign', { character, slot: 'basic.wildspark.0', clip: WAVE.clip });
    const rows = targetValidationRows(app, character);
    expect(rows.every((row) => row.area === 'animation' && row.ids[0] === WAVE.clip)).toBe(true);
    // an error of the contract shows as a warning, a warning as info (C1: nothing blocks a plain export)
    expect(rows.find((row) => row.code === 'contract.clip.contact')).toMatchObject({
      severity: 'warning',
      message: 'Basic attack: Needs a contact frame',
    });
    expect(rows.find((row) => row.code === 'contract.clip.basic-interval')?.severity).toBe('info');
  });

  it('the target survives a snapshot and reads its pinned contract offline', async () => {
    await runOk(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'wildspark' });
    const snapshot = app.store.snapshot();
    expect(Object.keys(snapshot.tables[TARGETS_TABLE] ?? {})).toEqual([`tgt:${character}`]);
    const reopened = createFakeEditorApp({ snapshot, skeleton: humanoidSkeleton() });
    const offline: Served = { requests: [], tamper: false };
    const kit = await loadTargetKit(reopened);
    kit.contractsOf(reopened, { fetch: servedFetch(offline) });
    expect(kit.slotStatuses(reopened, character)?.rows).toHaveLength(9);
    await kit.contractsOf(reopened).load('omoba', MODEL.revision);
    expect(offline.requests).toEqual([]);
  });

  it('a bundled file that fails its checksum is refused', async () => {
    served.tamper = true;
    const result = await runResult(app, 'target.bind', { character, game: 'omoba', gameCharacter: 'wildspark' });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'checksum' } });
  });
});
