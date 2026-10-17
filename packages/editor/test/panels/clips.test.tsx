import type { ClipRecord } from '@ekza-animator/doc';
import type { FakeServices } from '@ekza-animator/editor-core/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClipsPanel } from '../../src/panels/clips/ClipsPanel';
import {
  checkDraft,
  draftFromClip,
  fpsFromNumber,
  formatDuration,
  formatFps,
  parseTags,
  redistributionHint,
  validateClipName,
} from '../../src/panels/clips/settings';
import {
  by,
  CHARACTER,
  CLIP,
  callsOf,
  cleanup,
  input,
  loadFixtures,
  maybe,
  mount,
  newClip,
  setSession,
  transact,
  user,
  waveApp,
} from './helpers';

afterEach(cleanup);
beforeAll(async () => {
  await loadFixtures();
});

const panel = (app: ReturnType<typeof waveApp>) =>
  mount(app, <ClipsPanel app={app} instanceId="clips#1" />, {
    width: 420,
    height: 480,
  });

function wave(app: ReturnType<typeof waveApp>): ClipRecord {
  const clip = app.store.get('clips', CLIP);
  if (clip === undefined) throw new Error('no wave clip');
  return clip;
}

describe('Clips panel (FR-CLIP-01…03)', () => {
  it('lists the clips with the active radio, range and length, fps, loop and source', async () => {
    const app = waveApp();
    const idle = newClip(app, 'clp_SyntheticIdle0001', {
      name: 'Idle_Loop',
      fps: { num: 24, den: 1 },
      range: { start: 0, end: 48 },
      loop: false,
      source: { kind: 'embedded', asset: wave(app).id as never, animationIndex: 3, animationName: 'Idle_Loop' },
    });
    await transact(app, (tx) => tx.put('clips', idle));
    const view = await panel(app);
    const waveRow = by(`clips-row-${CLIP}`);
    expect(waveRow.dataset.active).toBe('true');
    expect(input(`clips-active-${CLIP}`).checked).toBe(true);
    expect(waveRow.textContent).toContain('wave');
    expect(waveRow.textContent).toContain('0–30');
    expect(waveRow.textContent).toContain('1.0 s');
    expect(waveRow.textContent).toContain('30');
    expect(waveRow.textContent).toContain('loops');
    expect(waveRow.textContent).toContain('New');
    const idleRow = by(`clips-row-${idle.id}`);
    expect(idleRow.dataset.active).toBeUndefined();
    expect(idleRow.textContent).toContain('0–48');
    expect(idleRow.textContent).toContain('2.0 s');
    expect(idleRow.textContent).toContain('24');
    expect(idleRow.textContent).toContain('once');
    expect(idleRow.textContent).toContain('Embedded');
    await view.unmount();
  });

  it('switches the active clip from a row or its radio, and follows the session', async () => {
    const app = waveApp();
    const idle = newClip(app, 'clp_SyntheticIdle0001', { name: 'idle' });
    await transact(app, (tx) => tx.put('clips', idle));
    const view = await panel(app);
    await user.click(by(`clips-row-${idle.id}`));
    await user.click(by(`clips-row-${CLIP}`)); // already active
    expect(callsOf(app, 'clip.setActive')).toEqual([{ clip: idle.id }]);
    await setSession(app, { activeClip: { [CHARACTER]: idle.id } });
    expect(input(`clips-active-${idle.id}`).checked).toBe(true);
    await user.click(input(`clips-active-${CLIP}`));
    expect(callsOf(app, 'clip.setActive')).toEqual([{ clip: idle.id }, { clip: CLIP }]);
    await view.unmount();
  });

  it('new, duplicate and delete run their operators for the active character and clip', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by('clips-new'));
    await user.click(by('clips-duplicate'));
    await user.click(by('clips-delete'));
    expect(callsOf(app, 'clip.new')).toEqual([{ character: CHARACTER }]);
    expect(callsOf(app, 'clip.duplicate')).toEqual([{ clip: CLIP }]);
    expect(callsOf(app, 'clip.delete')).toEqual([{ clip: CLIP }]);
    // Cancelled runs (no such operator in the fake app) are reported, not swallowed.
    expect((app.services as FakeServices).toasts).toContainEqual({
      kind: 'warning',
      text: "unknown operator 'clip.new'",
    });
    await view.unmount();
  });

  it('renames inline with validation (FR-CLIP-02): empty, characters, length and case-insensitive duplicates', async () => {
    const app = waveApp();
    await transact(app, (tx) => tx.put('clips', newClip(app, 'clp_SyntheticIdle0001', { name: 'Idle' })));
    const view = await panel(app);
    await user.dblClick(by(`clips-name-${CLIP}`));
    const field = input('clips-rename-input');
    expect(document.activeElement).toBe(field);
    const rejected: { readonly name: string; readonly invalid: string | undefined; readonly why: boolean }[] = [];
    for (const bad of ['', 'wave/1', 'idle', 'x'.repeat(65)]) {
      await user.fill(field, bad);
      await user.keyboard('{Enter}');
      const message = maybe('clips-rename-message');
      rejected.push({
        name: bad,
        invalid: field.dataset.invalid,
        why: message !== null && message.textContent === field.title && field.title.length > 0,
      });
    }
    expect(rejected).toEqual(
      ['', 'wave/1', 'idle', 'x'.repeat(65)].map((name) => ({ name, invalid: 'true', why: true })),
    );
    expect(by('clips-rename-message').textContent).toBe('At most 64 characters (65)');
    expect(field.getAttribute('aria-describedby')).toBe(by('clips-rename-message').id);
    expect(callsOf(app, 'clip.rename')).toEqual([]);
    await user.fill(field, '  wave_01 ');
    expect(maybe('clips-rename-message')).toBeNull();
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'clip.rename')).toEqual([{ clip: CLIP, name: 'wave_01' }]);
    expect(maybe('clips-rename-input')).toBeNull();

    // Esc cancels; an unchanged name runs nothing.
    await user.dblClick(by(`clips-name-${CLIP}`));
    await user.fill(input('clips-rename-input'), 'other');
    await user.keyboard('{Escape}');
    await user.dblClick(by(`clips-name-${CLIP}`));
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'clip.rename')).toHaveLength(1);
    await view.unmount();
  });

  it('has a context menu and row keys (F2 rename, Mod+D duplicate, Delete)', async () => {
    const app = waveApp({ platform: 'other' });
    const view = await panel(app);
    await user.rightClick(by(`clips-row-${CLIP}`));
    expect(by('clips-menu-active').getAttribute('aria-disabled')).toBe('true');
    await user.click(by('clips-menu-duplicate'));
    expect(callsOf(app, 'clip.duplicate')).toEqual([{ clip: CLIP }]);
    await user.rightClick(by(`clips-row-${CLIP}`));
    await user.click(by('clips-menu-rename'));
    expect(document.activeElement).toBe(input('clips-rename-input'));
    await user.keyboard('{Escape}');

    await user.click(input(`clips-active-${CLIP}`));
    await user.keyboard('{F2}');
    expect(maybe('clips-rename-input')).not.toBeNull();
    await user.keyboard('{Escape}');
    await user.click(input(`clips-active-${CLIP}`));
    await user.keyboard('{Control>}d{/Control}');
    await user.keyboard('{Delete}');
    expect(callsOf(app, 'clip.duplicate')).toHaveLength(2);
    expect(callsOf(app, 'clip.delete')).toEqual([{ clip: CLIP }]);
    await view.unmount();
  });

  it('shows an empty state without characters', async () => {
    const app = waveApp({ skeleton: false });
    await transact(app, (tx) => tx.softDelete('characters', CHARACTER));
    const view = await panel(app);
    expect(by('clips-empty').textContent).toContain('No character');
    expect((by('clips-new') as HTMLButtonElement).disabled).toBe(true);
    await view.unmount();
  });
});

describe('Clip settings popover (FR-CLIP-04, FR-CLIP-09)', () => {
  it('sends one clip.setSettings with exactly the changed fields', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by(`clips-settings-${CLIP}`));
    expect(by('clips-settings-popover')).toBeTruthy();
    expect((by('clip-settings-apply') as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(by('clip-settings-fps'), '24');
    await user.click(by('clip-settings-fps-mode-keep-frames'));
    await user.fill(by('clip-settings-range-end'), '48');
    await user.fill(by('clip-settings-scene-start'), '6');
    await user.click(by('clip-settings-loop'));
    await user.selectOptions(by('clip-settings-root-motion'), 'in-place');
    await user.selectOptions(by('clip-settings-slot'), 'wave');
    await user.fill(by('clip-settings-contact'), '12');
    await user.fill(by('clip-settings-tags'), 'Emote, LOOP emote');
    await user.selectOptions(by('clip-settings-redistributable'), 'unknown');
    await user.click(by('clip-settings-apply'));

    expect(callsOf(app, 'clip.setSettings')).toEqual([
      {
        clip: CLIP,
        fps: { num: 24, den: 1 },
        fpsMode: 'keep-frames',
        range: { start: 0, end: 48 },
        sceneStart: 6,
        loop: false,
        rootMotion: 'in-place',
        slot: 'wave',
        contact: 12,
        tags: ['emote', 'loop'],
        provenance: { redistributable: 'unknown' },
      },
    ]);
    // The fake app has no clip.setSettings: the run is cancelled and the popover stays open with the draft.
    expect(maybe('clips-settings-popover')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(maybe('clips-settings-popover')).toBeNull();
    await view.unmount();
  });

  it('closes when its clip goes away and stays closed when it comes back', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by(`clips-settings-${CLIP}`));
    expect(maybe('clips-settings-popover')).not.toBeNull();
    await transact(app, (tx) => tx.softDelete('clips', CLIP));
    expect(maybe('clips-settings-popover')).toBeNull();
    await transact(app, (tx) => tx.restore('clips', CLIP));
    expect(by(`clips-row-${CLIP}`)).toBeTruthy();
    expect(maybe('clips-settings-popover')).toBeNull();
    await view.unmount();
  });

  it('validates as you type and keeps Apply disabled while anything is invalid', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by(`clips-settings-${CLIP}`));
    const apply = by('clip-settings-apply') as HTMLButtonElement;

    await user.fill(by('clip-settings-range-end'), '-5');
    expect(by('clip-settings-error-rangeEnd').textContent).toContain('after the start');
    expect(apply.disabled).toBe(true);
    await user.fill(by('clip-settings-range-end'), '12.5');
    expect(by('clip-settings-error-rangeEnd').textContent).toContain('whole frame');
    await user.fill(by('clip-settings-range-end'), '60');
    expect(maybe('clip-settings-error-rangeEnd')).toBeNull();

    await user.fill(by('clip-settings-contact'), '61');
    expect(by('clip-settings-error-contact').textContent).toContain('0–60');
    await user.fill(by('clip-settings-contact'), '');
    expect(maybe('clip-settings-error-contact')).toBeNull();

    await user.fill(by('clip-settings-tags'), 'a b c d e f g h i');
    expect(by('clip-settings-error-tags').textContent).toContain('At most 8');
    await user.fill(by('clip-settings-tags'), 'émote');
    expect(by('clip-settings-error-tags').textContent).toContain('a–z');
    await user.fill(by('clip-settings-tags'), 'synthetic');

    await user.selectOptions(by('clip-settings-fps'), 'custom');
    await user.fill(by('clip-settings-fps-custom'), '0');
    expect(by('clip-settings-error-fps').textContent).toContain('above 0');
    await user.fill(by('clip-settings-fps-custom'), '29.97');
    expect(maybe('clip-settings-error-fps')).toBeNull();
    expect((by('clip-settings-fps-mode-keep-seconds') as HTMLInputElement).disabled).toBe(false);

    expect(apply.disabled).toBe(false);
    await user.click(apply);
    expect(callsOf(app, 'clip.setSettings')).toEqual([
      { clip: CLIP, fps: { num: 30000, den: 1001 }, fpsMode: 'keep-seconds', range: { start: 0, end: 60 } },
    ]);

    await user.click(by('clip-settings-reset'));
    expect((by('clip-settings-range-end') as HTMLInputElement).value).toBe('30');
    await view.unmount();
  });

  it('edits provenance sources with a licence picker and the redistributable state', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by(`clips-settings-${CLIP}`));
    expect(by('clip-redistributable-badge').dataset.state).toBe('yes');
    await user.click(by('clip-settings-source-add'));
    expect(by('clip-settings-source-0-error-title').textContent).toContain('title');
    await user.fill(by('clip-settings-source-0-title'), 'Universal Animation Library');
    await user.fill(by('clip-settings-source-0-author'), 'Quaternius');
    await user.selectOptions(by('clip-settings-source-0-license'), 'other');
    await user.fill(by('clip-settings-source-0-license-other'), 'not a licence');
    expect(by('clip-settings-source-0-error-license').textContent).toContain('SPDX');
    await user.fill(by('clip-settings-source-0-license-other'), 'CC-BY-3.0');
    await user.fill(by('clip-settings-source-0-sha'), 'abc');
    expect(by('clip-settings-source-0-error-sourceSha256').textContent).toContain('64 hex');
    await user.fill(by('clip-settings-source-0-sha'), 'A'.repeat(64));
    expect(maybe('clip-settings-redistribution-hint')).toBeNull();
    // A source whose licence does not obviously allow sharing makes 'yes' questionable (a hint, not an error).
    await user.selectOptions(by('clip-settings-source-0-license'), 'proprietary');
    expect(by('clip-settings-redistribution-hint').textContent).toContain('source 1 is proprietary');
    expect((by('clip-settings-apply') as HTMLButtonElement).disabled).toBe(false);
    await user.selectOptions(by('clip-settings-source-0-license'), 'other');
    await user.selectOptions(by('clip-settings-redistributable'), 'no');
    expect(maybe('clip-settings-redistribution-hint')).toBeNull();
    expect(by('clip-redistributable-badge').dataset.state).toBe('no');
    await user.click(by('clip-settings-apply'));
    expect(callsOf(app, 'clip.setSettings')).toEqual([
      {
        clip: CLIP,
        provenance: {
          derivedFrom: [
            {
              title: 'Universal Animation Library',
              author: 'Quaternius',
              license: 'CC-BY-3.0',
              sourceSha256: 'a'.repeat(64),
            },
          ],
          redistributable: 'no',
        },
      },
    ]);
    await user.click(by('clip-settings-source-0-remove'));
    expect(maybe('clip-settings-source-0-title')).toBeNull();
    await view.unmount();
  });
});

describe('clip settings rules', () => {
  it('validates clip names (ClipRecord.name, ADR 0010 ekza.unique-names)', () => {
    expect(validateClipName('wave_01', ['idle'])).toBeNull();
    expect(validateClipName('Walk Cycle-2.final', [])).toBeNull();
    expect(validateClipName('', [])).toContain('needs a name');
    expect(validateClipName('a'.repeat(64), [])).toBeNull();
    expect(validateClipName('a'.repeat(65), [])).toContain('64');
    expect(validateClipName('wave!', [])).toContain('letters');
    expect(validateClipName('IDLE', ['idle'])).toContain('already');
  });

  it('turns typed frame rates into rationals', () => {
    expect(fpsFromNumber(24)).toEqual({ num: 24, den: 1 });
    expect(fpsFromNumber(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(fpsFromNumber(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(fpsFromNumber(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(fpsFromNumber(12.5)).toEqual({ num: 25, den: 2 });
    expect(fpsFromNumber(0)).toBeNull();
    expect(fpsFromNumber(-24)).toBeNull();
    expect(fpsFromNumber(Number.NaN)).toBeNull();
    expect(fpsFromNumber(5000)).toBeNull();
    expect(formatFps({ num: 30000, den: 1001 })).toBe('29.97');
    expect(formatFps({ num: 24, den: 1 })).toBe('24');
    expect(formatDuration({ start: 0, end: 48 }, { num: 24, den: 1 })).toBe('2.0 s');
  });

  it('parses tags: lowercase, deduplicated, at most 8, [a-z0-9_-]', () => {
    expect(parseTags('Emote, loop  EMOTE,,')).toEqual({ tags: ['emote', 'loop'] });
    expect(parseTags('')).toEqual({ tags: [] });
    expect(parseTags('a b c d e f g h')).toEqual({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    expect(parseTags('a b c d e f g h i')).toHaveProperty('error');
    expect(parseTags('no.dots')).toHaveProperty('error');
  });

  it('an untouched draft changes nothing; a contact frame follows the new range', async () => {
    const clip = wave(waveApp());
    const draft = draftFromClip(clip);
    expect(checkDraft(clip, draft)).toEqual({ errors: {}, args: null, fpsChanged: false });
    expect(checkDraft(clip, { ...draft, contact: '40' }).errors.contact).toContain('0–30');
    expect(checkDraft(clip, { ...draft, contact: '40', rangeEnd: '45' }).args).toEqual({
      clip: clip.id,
      range: { start: 0, end: 45 },
      contact: 40,
    });
    expect(checkDraft(clip, { ...draft, rangeStart: '+=5', rangeEnd: '*2' }).args).toEqual({
      clip: clip.id,
      range: { start: 5, end: 60 },
    });
    expect(checkDraft(clip, { ...draft, slot: 'tpose' }).errors.slot).toContain('not an Ekza slot');
    expect(checkDraft({ ...clip, slot: 'wave' }, { ...draft, slot: '' }).args).toEqual({ clip: clip.id, slot: null });
  });

  it('hints when a redistributable clip has sources under unknown, proprietary or no-derivatives licences', () => {
    const clip = waveApp().store.get('clips', CLIP) as ClipRecord;
    const draft = draftFromClip(clip);
    const source = (license: string, licenseOther = '') => ({
      title: 'Source',
      author: '',
      license,
      licenseOther,
      sourceSha256: '',
    });
    expect(redistributionHint(draft)).toBeNull(); // authored from scratch
    expect(redistributionHint({ ...draft, sources: [source('CC0-1.0'), source('CC-BY-4.0')] })).toBeNull();
    expect(
      redistributionHint({
        ...draft,
        sources: [source('CC0-1.0'), source('unknown'), source('other', 'CC-BY-ND-4.0')],
      }),
    ).toBe(
      'Marked redistributable, but source 2 is unknown, source 3 is CC-BY-ND-4.0: check that you may share clips made from it.',
    );
    expect(redistributionHint({ ...draft, sources: [source('proprietary')], redistributable: 'no' })).toBeNull();
    expect(redistributionHint({ ...draft, sources: [source('proprietary')], redistributable: 'unknown' })).toBeNull();
  });
});
