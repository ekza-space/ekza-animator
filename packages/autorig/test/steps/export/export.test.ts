// AUTORIG-SPEC §5.6 (D6): ⑤'s pure parts — the checklist (every error row of the profile listed and gating, warnings
// and info never gating, byte rules "checked when you download" until a file is written and then measured, the
// rule-label table with the unknown-rule fallback, live rows superseding a download's), the measures of a written
// GLB, the `export` slice reducers, the expected file names and the remembered author.
import { describe, expect, it } from 'vitest';
import { messages } from '../../../src/i18n';
import { defaultAutoRigSession, createAutoRigSessionStore } from '../../../src/session';
import { AUTHOR_KEY, rememberAuthor, rememberedAuthor } from '../../../src/steps/export/author';
import { expectedFileName, slugOf } from '../../../src/steps/export/files';
import { publishToHub } from '../../../src/steps/export/hub';
import { EXPORT_SLICE } from '../../../src/steps/export';
import {
  type ChecklistInputRow,
  checklistOf,
  checksOf,
  firstError,
  isLiveRule,
  mergeRows,
  ruleLabel,
} from '../../../src/steps/export/labels';
import { freeSlots, inVrm, leftOutClips, suggestedSlot } from '../../../src/steps/export/leftOut';
import { formatBytes, glbJsonChunk, measureArtifact } from '../../../src/steps/export/measure';
import { chooseTarget, currentDownload, recordDownload, shownTarget } from '../../../src/steps/export/slice';

const m = messages().export;
const row = (
  code: string,
  severity: ChecklistInputRow['severity'],
  message = `${code} message`,
): ChecklistInputRow => ({
  code,
  severity,
  message,
});

/** A GLB with the given JSON and a BIN chunk of `bin` bytes. */
function glb(json: object, bin = 0): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + (bin > 0 ? 8 + bin : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  if (bin > 0) {
    view.setUint32(20 + jsonBytes.length, bin, true);
    view.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  }
  return out;
}

describe('the checklist (§5.6.2)', () => {
  it('a clean VRM before a download: the document checks ✓, the byte checks pending, nothing gates', () => {
    const items = checklistOf({ target: 'ekza-vrm', modelCharacter: true, live: [], written: null, measured: null });
    expect(items.map((item) => [item.id, item.state])).toEqual([
      ['humanoid', 'ok'],
      ['required-bones', 'ok'],
      ['parents', 'ok'],
      ['tpose', 'ok'],
      ['skinned', 'ok'],
      ['transforms', 'ok'],
      ['size', 'pending'],
      ['nodes', 'pending'],
      ['bones', 'pending'],
      ['extensions', 'pending'],
      ['meta', 'ok'],
      ['licence', 'ok'],
      ['thumbnail', 'ok'],
      ['read-back', 'pending'],
    ]);
    expect(items.find((item) => item.id === 'tpose')?.label).toBe('T-pose rest');
    expect(firstError(items)).toBeNull();
  });

  it('every error row of the profile is listed and gates; warnings and info rows never gate', () => {
    const live = [
      row('vrm.meta-required', 'error'),
      row('vrm.licence-unset', 'error'),
      row('vrm.thumbnail-square', 'warning'),
      row('skel.tpose', 'error', 'The arms are 12° below the T-pose'),
      row('skin.joint-without-weights', 'info'),
      row('skin.cross-side', 'warning'),
    ];
    const items = checklistOf({ target: 'ekza-vrm', modelCharacter: true, live, written: null, measured: null });
    const state = (id: string) => items.find((item) => item.id === id)?.state;
    expect([state('meta'), state('licence'), state('tpose'), state('thumbnail')]).toEqual([
      'error',
      'error',
      'error',
      'warning',
    ]);
    // the rows no check covers, by the label table
    expect(items.filter((item) => !item.check).map((item) => [item.id, item.label, item.state])).toEqual([
      ['skin.cross-side', 'No left/right weight mix-ups', 'warning'],
      ['skin.joint-without-weights', 'Some joints move no points', 'info'],
    ]);
    // every error row appears in an item
    const listed = new Set(items.flatMap((item) => item.rows.map((r) => r.code)));
    for (const r of live) expect(listed.has(r.code)).toBe(true);
    expect(items.find((item) => item.id === 'tpose')?.rows[0]?.message).toBe('The arms are 12° below the T-pose');
    expect(firstError(items)?.id).toBe('tpose');
    // only warnings and info: nothing gates
    const soft = checklistOf({
      target: 'ekza-vrm',
      modelCharacter: true,
      live: live.filter((r) => r.severity !== 'error'),
      written: null,
      measured: null,
    });
    expect(firstError(soft)).toBeNull();
  });

  it('an unknown rule id shows its own message (a new lint is never hidden)', () => {
    const items = checklistOf({
      target: 'ekza-vrm',
      modelCharacter: true,
      live: [row('skel.brand-new-rule', 'error', 'Something new is wrong')],
      written: null,
      measured: null,
    });
    const extra = items.find((item) => item.id === 'skel.brand-new-rule');
    expect(extra).toMatchObject({ label: 'Something new is wrong', state: 'error', check: false });
    expect(firstError(items)?.id).toBe('skel.brand-new-rule');
    expect(ruleLabel('skel.brand-new-rule')).toBeNull();
    expect(ruleLabel('vrm.meta-required')).toBe('Name and author set');
    expect(ruleLabel('vrm.licence-unset')).toBe('Licence chosen');
    expect(ruleLabel('skel.tpose')).toBe('T-pose rest');
    expect(ruleLabel('skin.unbound')).toBe('Every part skinned');
  });

  it('after a download: byte rows join, measures replace the byte labels; live rows supersede the written ones', () => {
    const written = [
      row('vrm.meta-required', 'error', 'stale: the meta row of the written file'),
      row('vrm.glb-size', 'error', 'The file is 51 MiB'),
      row('validator.SOMETHING', 'error', 'glTF-Validator: bad'),
    ];
    const items = checklistOf({
      target: 'omoba-kit',
      modelCharacter: true,
      live: [],
      written,
      measured: {
        size: 'File 51.0 MiB / 50 MiB · JSON 61 KiB',
        nodes: '412 / 4,096 nodes',
        bones: '33 of 64 humanoid bones',
      },
    });
    const by = (id: string) => items.find((item) => item.id === id);
    expect(by('meta')?.state).toBe('ok'); // the live document has the meta now
    expect(by('size')).toMatchObject({ state: 'error', label: 'File 51.0 MiB / 50 MiB · JSON 61 KiB' });
    expect(by('nodes')).toMatchObject({ state: 'ok', label: '412 / 4,096 nodes' });
    expect(by('bones')).toMatchObject({ state: 'ok', label: '33 of 64 humanoid bones' });
    expect(by('extensions')?.state).toBe('ok');
    expect(by('read-back')?.state).toBe('error');
    expect(mergeRows([row('skel.tpose', 'error')], written).map((r) => r.code)).toEqual([
      'skel.tpose',
      'vrm.glb-size',
      'validator.SOMETHING',
    ]);
    expect([isLiveRule('vrm.meta-required'), isLiveRule('skin.unbound'), isLiveRule('vrm.glb-size')]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('a blocked byte lint: its row is an error and Download stays disabled until the document changes', () => {
    // autorig.export refused the file: the live document is clean, the written file broke OMOBA's ±1e6 rule
    const last = {
      character: 'chr_lad',
      target: 'ekza-vrm' as const,
      version: 7,
      lints: [row('vrm.translation-range', 'error', 'VRM node 12 translation exceeds the supported range')],
    };
    const column = (version: number) => {
      const current = currentDownload(last, 'chr_lad', 'ekza-vrm', version);
      return checklistOf({
        target: 'ekza-vrm',
        modelCharacter: true,
        live: [],
        written: current === null ? null : current.lints,
        measured: null,
      });
    };
    const blocked = column(7);
    const transforms = blocked.find((item) => item.id === 'transforms');
    expect(transforms).toMatchObject({ state: 'error', check: true });
    expect(transforms?.rows.map((r) => r.message)).toEqual(['VRM node 12 translation exceeds the supported range']);
    expect(firstError(blocked)?.id).toBe('transforms'); // Download disabled
    // nothing changed: still the same file, still disabled
    expect(firstError(column(7))?.id).toBe('transforms');
    // an edit: the byte rows are stale and dropped, the byte checks wait for the next file, Download is enabled
    const edited = column(8);
    expect(firstError(edited)).toBeNull();
    expect(edited.find((item) => item.id === 'transforms')?.state).toBe('ok');
    expect(edited.find((item) => item.id === 'read-back')?.state).toBe('pending');
    // another target or character never shows this file's rows
    expect(currentDownload(last, 'chr_lad', 'glb', 7)).toBeNull();
    expect(currentDownload(last, 'chr_other', 'ekza-vrm', 7)).toBeNull();
    expect(currentDownload(last, null, 'ekza-vrm', 7)).toBeNull();
    expect(currentDownload(null, 'chr_lad', 'ekza-vrm', 7)).toBeNull();
  });

  it('per target: GLB has no VRM checks, VRMA only its file checks, an imported avatar waits for its file', () => {
    expect(checksOf('glb', true).map((c) => c.id)).toEqual(['skeleton', 'tpose', 'skinned', 'transforms', 'read-back']);
    expect(checksOf('vrma', true).map((c) => c.id)).toEqual(['read-back']);
    const asset = checklistOf({ target: 'ekza-vrm', modelCharacter: false, live: [], written: null, measured: null });
    expect(asset.every((item) => item.state === 'pending')).toBe(true);
    expect(asset.some((item) => item.id === 'meta')).toBe(false);
    const glb = checklistOf({
      target: 'glb',
      modelCharacter: true,
      live: [row('skel.tpose', 'warning')],
      written: null,
      measured: null,
    });
    expect(glb.find((item) => item.id === 'tpose')?.state).toBe('warning');
    expect(firstError(glb)).toBeNull();
  });
});

describe('honest VRM version and clips left out of the VRM (AR-D8-2, AR-D8-5)', () => {
  it('an imported VRM 0.x avatar’s humanoid check names the kept version; VRM 1.0 and model characters do not', () => {
    const label = (vrm0: boolean, model: boolean) =>
      checklistOf({ target: 'ekza-vrm', modelCharacter: model, vrm0, live: [], written: null, measured: null }).find(
        (item) => item.id === 'humanoid',
      )?.label;
    expect(label(true, false)).toBe('VRM 0.x humanoid (kept as it is)');
    expect(label(false, false)).toBe('VRM 1.0 humanoid');
    expect(label(true, true)).toBe('VRM 1.0 humanoid');
    expect(m.targetVrm0).toContain('VRM 0.x');
  });

  it('model characters keep slotted clips; imported avatars clips with an Ekza name; the fix suggests a free slot', () => {
    const clips = [
      { id: 'c1', name: 'Idle', slot: 'idle' },
      { id: 'c2', name: 'Sword attack', slot: 'attack' },
      { id: 'c3', name: 'Punch', slot: null },
      { id: 'c4', name: 'Jog', slot: null },
      { id: 'c5', name: 'wave', slot: null },
      { id: 'c6', name: 'Jump loop', slot: null },
    ];
    expect(leftOutClips(true, clips).map((c) => c.id)).toEqual(['c3', 'c4', 'c5', 'c6']);
    expect(leftOutClips(false, clips).map((c) => c.id)).toEqual(['c3', 'c4', 'c6']);
    expect(inVrm(false, { id: 'x', name: 'tpose', slot: null })).toBe(false);
    const free = freeSlots(clips);
    expect(free).not.toContain('idle');
    expect(free).not.toContain('attack');
    expect(free).not.toContain('wave');
    // Punch would be an attack, which Sword attack holds: the list only; Jog runs; Jump loop jumps
    expect(suggestedSlot(clips[2]!, free)).toBeNull();
    expect(suggestedSlot(clips[3]!, free)).toBe('run');
    expect(suggestedSlot(clips[5]!, free)).toBe('jump');
    expect(suggestedSlot({ id: 'p', name: 'Punch', slot: null }, freeSlots([]))).toBe('attack');
    expect(m.leftOutTitle(1)).toBe('Not in the VRM: 1 animation has no OMOBA slot');
  });
});

describe('measures of a written file (§5.6.2)', () => {
  it('file and JSON size, nodes and humanoid bones (the read-back first, else VRMC_vrm)', () => {
    const json = {
      asset: { version: '2.0' },
      nodes: Array.from({ length: 412 }, () => ({})),
      extensions: { VRMC_vrm: { humanoid: { humanBones: { hips: { node: 0 }, spine: { node: 1 } } } } },
    };
    const bytes = glb(json, 400_000);
    expect(glbJsonChunk(bytes)?.json?.['nodes']).toHaveLength(412);
    expect(measureArtifact({ bytes, readBack: null })).toEqual({
      size: m.measuredSize(formatBytes(bytes.byteLength), formatBytes(glbJsonChunk(bytes)?.length ?? 0)),
      nodes: '412 / 4,096 nodes',
      bones: '2 of 64 humanoid bones',
    });
    expect(measureArtifact({ bytes, readBack: { humanoid: 33 } as never })?.bones).toBe('33 of 64 humanoid bones');
    expect(measureArtifact({ bytes: new Uint8Array([80, 75, 3, 4]), readBack: null })).toBeNull();
    expect(formatBytes(400_000)).toBe('0.4 MiB');
    expect(formatBytes(61 * 1024)).toBe('61 KiB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MiB');
  });
});

describe('the export slice (§4.3)', () => {
  it('defaults to the recommended target; choosing another clears the download check', () => {
    expect(EXPORT_SLICE).toEqual({ target: 'ekza-vrm', downloaded: false });
    const session = createAutoRigSessionStore(defaultAutoRigSession(), null);
    recordDownload(session, true);
    expect(session.getState().export).toEqual({ target: 'ekza-vrm', downloaded: true });
    chooseTarget(session, 'ekza-vrm');
    expect(session.getState().export.downloaded).toBe(true);
    chooseTarget(session, 'omoba-kit');
    expect(session.getState().export).toEqual({ target: 'omoba-kit', downloaded: false });
    recordDownload(session, false);
    expect(session.getState().export.downloaded).toBe(false);
  });

  it('shows the chosen target when available, else the first available one', () => {
    expect(shownTarget({ target: 'vrma', downloaded: false }, ['ekza-vrm', 'glb', 'vrma'])).toBe('vrma');
    expect(shownTarget({ target: 'vrma', downloaded: false }, ['ekza-vrm', 'glb'])).toBe('ekza-vrm');
    expect(shownTarget({ target: 'glb', downloaded: false }, [])).toBeNull();
  });
});

describe('file names and notes (§5.6.1, §5.6.4, §5.6.5)', () => {
  it('the slug and the saved file of each target', () => {
    expect(slugOf('Cube Lad')).toBe('cube-lad');
    expect(slugOf('Zoë — the Ränger!!')).toBe('zoe-the-ranger');
    // io's omobaSlug, rule for rule (the hint names the file autorig.export saves)
    expect(slugOf('Аватар')).toBe('avatar-9f935759');
    expect(slugOf('')).toBe('avatar');
    expect(slugOf('Ekza Bot')).toBe('studio-ekza-bot');
    expect(slugOf('ekza')).toBe('ekza');
    expect(slugOf(`ekza ${'y'.repeat(70)}`)).toBe(`studio-ekza-${'y'.repeat(52)}`);
    expect(expectedFileName('omoba-kit', 'Ekza Bot', 0, null)).toBe('studio-ekza-bot-omoba-kit.zip');
    expect(expectedFileName('ekza-vrm', 'Polybot', 0, null)).toBe('polybot.vrm');
    expect(expectedFileName('glb', 'Cube Lad', 2, 'idle')).toBe('cube-lad.glb');
    expect(expectedFileName('omoba-kit', 'Cube Lad', 2, 'idle')).toBe('cube-lad-omoba-kit.zip');
    expect(expectedFileName('vrma', 'Cube Lad', 2, 'idle')).toBe('cube-lad-animations.zip');
    expect(expectedFileName('vrma', 'Cube Lad', 1, 'walk')).toBe('cube-lad-walk.vrma');
    expect(m.targetVrmaHint(2, 'cube-lad-animations.zip')).toBe('2 clips → cube-lad-animations.zip');
  });

  it('Publish to Ekza Hub stays off (absent) until the M4a T3 slice', () => {
    expect(publishToHub()).toBe(false);
    expect(m.hubNote).toBe('Upload this file to Ekza Hub to use it in OMOBA online.');
    expect(m.omobaNote).toBe('OMOBA plays its own motion library on your VRM; your clips play in Space.');
  });
});

describe('the remembered author (§5.6.3)', () => {
  it('remembers the last author in localStorage; blocked or throwing storage remembers nothing', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
    expect(rememberedAuthor(storage)).toBeNull();
    rememberAuthor('  Tester ', storage);
    expect(map.get(AUTHOR_KEY)).toBe('Tester');
    expect(rememberedAuthor(storage)).toBe('Tester');
    rememberAuthor('', storage);
    expect(rememberedAuthor(storage)).toBe('Tester');
    expect(rememberedAuthor(null)).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rememberedAuthor(throwing)).toBeNull();
    expect(() => rememberAuthor('A', throwing)).not.toThrow();
  });
});
