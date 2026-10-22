// AUTORIG-SPEC §5.5 (D5): the ④ step's pure parts — the category table (unknown ids in "Other", `jump-*` in Move),
// the search over label, id and source with synonyms, the `ar-*` tag reader (pinned by the same examples as
// editor-core's writer, `editor-core/test/autorig/clip.test.ts`), the library clip of a document clip (tags, or a
// plain Use Clip's provenance), the slice's reducers through the session store, the ④ keys (`/`, `A`; Space is the
// view's) and the `.vrma` drop routing.
import type { ClipId, ClipRecord } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { AUTORIG_KEYMAP, type ClipParams } from '../../../src';
import { createAutoRigSessionStore } from '../../../src/session';
import { bindingFor } from '../../../src/shell/keys';
import type { WizardContext } from '../../../src/shell/context';
import {
  ANIMATIONS_SLICE,
  clearDraft,
  editClip,
  endEdit,
  IDENTITY_CLIP_PARAMS,
  isVrmaFile,
  markSkipped,
  setDraft,
  stepFiles,
} from '../../../src/steps/animations';
import { libraryClipOf, type StarterPackManifest } from '../../../src/steps/animations/actions';
import {
  CATEGORIES,
  categoryOf,
  filterClips,
  IDENTITY,
  isIdentity,
  matchesQuery,
  paramsFromTags,
  SLOT_VOCABULARY,
  speedText,
} from '../../../src/steps/animations/data';

const params = (fields: Partial<ClipParams>): ClipParams => ({ ...IDENTITY_CLIP_PARAMS, ...fields });

const PACK = [
  { id: 'idle', label: 'Idle', source: 'Idle_Loop' },
  { id: 'walk', label: 'Walk', source: 'Walk_Loop' },
  { id: 'sword-attack', label: 'Sword attack', source: 'Sword_Attack' },
  { id: 'punch', label: 'Punch', source: 'Punch_Jab' },
  { id: 'pistol-shoot', label: 'Pistol shoot', source: 'Pistol_Shoot' },
  { id: 'jump-start', label: 'Jump start', source: 'Jump_Start' },
  { id: 'dance', label: 'Dance', source: 'Dance_Loop' },
  { id: 'hit', label: 'Hit', source: 'Hit_Chest' },
  { id: 'cartwheel', label: 'Cartwheel', source: 'Cartwheel' },
];

describe('the grid data (§5.5.1)', () => {
  it('maps ids to categories; unknown ids fall into Other, jump-* into Move', () => {
    expect(['idle', 'walk', 'run', 'jog', 'jump-start', 'jump-loop', 'jump-land'].map(categoryOf)).toEqual(
      Array(7).fill('move'),
    );
    expect(['sword-attack', 'punch', 'cast', 'pistol-shoot'].map(categoryOf)).toEqual(Array(4).fill('combat'));
    expect(['hit', 'death'].map(categoryOf)).toEqual(['react', 'react']);
    expect(categoryOf('dance')).toBe('fun');
    expect(categoryOf('cartwheel')).toBe('other');
    expect(CATEGORIES[0]).toBe('all');
    expect(filterClips(PACK, 'combat', '').map((c) => c.id)).toEqual(['sword-attack', 'punch', 'pistol-shoot']);
    expect(filterClips(PACK, 'other', '').map((c) => c.id)).toEqual(['cartwheel']);
  });

  it('searches label, id and source case-insensitively, with synonyms', () => {
    expect(filterClips(PACK, 'all', 'WALK').map((c) => c.id)).toEqual(['walk']);
    expect(filterClips(PACK, 'all', 'loop').map((c) => c.id)).toEqual(['idle', 'walk', 'dance']);
    expect(filterClips(PACK, 'all', 'attack').map((c) => c.id)).toEqual(['sword-attack', 'punch']);
    expect(filterClips(PACK, 'all', 'stand').map((c) => c.id)).toEqual(['idle']);
    expect(filterClips(PACK, 'all', 'shoot').map((c) => c.id)).toEqual(['pistol-shoot']);
    expect(filterClips(PACK, 'all', 'jump start').map((c) => c.id)).toEqual(['jump-start']);
    expect(filterClips(PACK, 'all', '  ').length).toBe(PACK.length);
    expect(matchesQuery({ id: 'walk', label: 'Walk', source: 'Walk_Loop' }, 'zzz')).toBe(false);
    expect(filterClips(PACK, 'move', 'attack')).toEqual([]);
  });

  it('offers the Ekza slot vocabulary without tpose; speeds read as ×n', () => {
    expect(SLOT_VOCABULARY).toContain('walk');
    expect(SLOT_VOCABULARY).not.toContain('tpose');
    expect(speedText(1)).toBeNull();
    expect(speedText(1.2)).toBe('×1.2');
    expect(speedText(0.25)).toBe('×0.25');
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(IDENTITY).toEqual(IDENTITY_CLIP_PARAMS);
    expect(isIdentity(params({ mirror: true }))).toBe(false);
  });
});

describe('ar-* tags (§5.5.4)', () => {
  // The same examples pin editor-core's writer (`clipParamTags`, test/autorig/clip.test.ts).
  const EXAMPLES: readonly [string, ClipParams, readonly string[]][] = [
    ['walk', params({ speed: 1.2, inPlace: true }), ['ar-walk', 'ar-speed-120', 'ar-inplace']],
    [
      'sword-attack',
      params({ trim: { start: 0.25, end: 1.2 }, mirror: true, armSpace: -10 }),
      ['ar-sword-attack', 'ar-trim-250-1200', 'ar-mirror', 'ar-arms-m10'],
    ],
    ['jump-start', params({ speed: 0.25, armSpace: 30 }), ['ar-jump-start', 'ar-speed-25', 'ar-arms-30']],
  ];
  it.each(EXAMPLES)('%s: %j ← %j', (clip, p, tags) => {
    expect(paramsFromTags(tags)).toEqual({ clip, params: p });
  });
  it('ignores other tags and needs the library id', () => {
    expect(paramsFromTags([])).toBeNull();
    expect(paramsFromTags(['hero', 'ar-mirror'])).toBeNull();
    expect(paramsFromTags(['hero', 'ar-idle', 'ar-mirror'])).toEqual({
      clip: 'idle',
      params: params({ mirror: true }),
    });
  });
});

describe('the library clip of a document clip (✎)', () => {
  const manifest = {
    clips: [
      { id: 'walk', source: 'Walk_Loop', credit: 'Quaternius' },
      { id: 'idle', source: 'Idle_Loop', credit: 'Quaternius' },
    ],
  } as unknown as StarterPackManifest;
  const clip = (fields: Partial<ClipRecord>): ClipRecord =>
    ({
      tags: [],
      provenance: { derivedFrom: [{ title: 'Walk_Loop', author: 'Quaternius', license: 'CC0-1.0' }] },
      ...fields,
    }) as unknown as ClipRecord;
  it('reads the tags first, then a plain Use Clip by its provenance; anything else is no library clip', () => {
    expect(libraryClipOf(manifest, clip({ tags: ['ar-idle', 'ar-speed-150'] }))).toEqual({
      clip: 'idle',
      params: params({ speed: 1.5 }),
    });
    expect(libraryClipOf(manifest, clip({}))).toEqual({ clip: 'walk', params: IDENTITY });
    const dropped = clip({ provenance: { derivedFrom: [{ title: 'my-dance', author: 'unknown' }] } as never });
    expect(libraryClipOf(manifest, dropped)).toBeNull();
    expect(libraryClipOf(manifest, clip({ tags: ['ar-gone'] }))).toBeNull();
  });
});

describe('the animations slice (§4.3)', () => {
  it('keeps the draft per library clip, Skip and the ✎ edit; U state only', () => {
    const store = createAutoRigSessionStore();
    expect(store.getState().animations).toEqual(ANIMATIONS_SLICE);
    setDraft(store, 'walk', params({ speed: 1.2 }));
    setDraft(store, 'idle', params({ mirror: true }));
    expect(store.getState().animations.draft).toEqual({ walk: params({ speed: 1.2 }), idle: params({ mirror: true }) });
    clearDraft(store, 'walk');
    expect(Object.keys(store.getState().animations.draft)).toEqual(['idle']);
    editClip(store, 'clp_1' as ClipId, 'walk', params({ armSpace: 5 }));
    expect(store.getState().animations.editing).toBe('clp_1');
    expect(store.getState().animations.draft['walk']).toEqual(params({ armSpace: 5 }));
    endEdit(store);
    expect(store.getState().animations.editing).toBeNull();
    markSkipped(store);
    expect(store.getState().animations.skipped).toBe(true);
    store.resetSubject({ character: null, meshes: [] });
    expect(store.getState().animations).toEqual(ANIMATIONS_SLICE);
  });
});

describe('the ④ keys and drops (§8.1, §5.5.4)', () => {
  const key = (code: string, target: EventTarget | null = null): KeyboardEvent =>
    ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target }) as KeyboardEvent;
  it('binds / and A in ④ only; Space is the view’s (form controls keep theirs)', () => {
    expect(bindingFor(key('Slash'), 'animations', true)?.run).toEqual({ action: 'animations.search' });
    expect(bindingFor(key('KeyA'), 'animations', false)?.run).toEqual({ action: 'animations.add' });
    expect(bindingFor(key('KeyA'), 'model', false)).toBeNull();
    expect(
      bindingFor(key('Slash', { tagName: 'INPUT', type: 'search' } as unknown as EventTarget), 'animations', true),
    ).toBeNull();
    expect(AUTORIG_KEYMAP.some((binding) => binding.chord.code === 'Space' && binding.chord.ctrl !== true)).toBe(false);
  });

  it('takes .vrma files only; anything else goes to ①', () => {
    expect(isVrmaFile('dance.VRMA')).toBe(true);
    expect(isVrmaFile('dance.glb')).toBe(false);
    const ctx = {} as WizardContext;
    expect(stepFiles(ctx, [])).toBe(false);
    expect(stepFiles(ctx, [{ name: 'body.glb' } as File, { name: 'a.vrma' } as File])).toBe(false);
  });
});
