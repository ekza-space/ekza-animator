// Renamed preference and argument ids (DECISIONS-OPEN TM-1): values written by earlier builds still load, as their
// current ids, and are never written back. The old spellings live only in `src/prefs/legacy.ts`; these tests read
// them from its table.
import type { JointId, SkeletonId } from '@ekza-studio/doc';
import { DEFAULT_FLEXION } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { defaultPrefs, type Prefs, type PrefsStorage } from '../../src';
import {
  LEGACY_ARGS,
  LEGACY_IDS,
  migrateLegacyArgs,
  migrateLegacyId,
  migrateLegacyPrefs,
} from '../../src/prefs/legacy';
import { loadPrefs, PREFS_STORAGE_KEY, sanitizePrefs, savePrefs } from '../../src/prefs/persist';
import { opsApp, runOk } from '../builtin/support';
import { rigTestApp, truthMarkers } from '../m6b/skeleton-kernel/support';

function memoryStorage(initial?: Record<string, string>): PrefsStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const entries = (table: Readonly<Record<string, string>>): [string, string][] => Object.entries(table);

describe('legacy id table', () => {
  it('names every renamed field and maps each old id to a current, valid id', () => {
    expect(Object.keys(LEGACY_IDS).sort()).toEqual([
      'navProfile',
      'orientPreset',
      'primitiveDefaults',
      'spaceBehaviour',
    ]);
    expect(Object.values(LEGACY_IDS.navProfile).sort()).toEqual(['dcc', 'oneButton']);
    expect(Object.values(LEGACY_IDS.spaceBehaviour)).toEqual(['maximize']);
    expect(Object.values(LEGACY_IDS.primitiveDefaults)).toEqual(['dcc']);
    expect(Object.values(LEGACY_IDS.orientPreset).sort()).toEqual(['xAim', 'yAim']);
    // No old id is also a current id (a mapping must never be the identity).
    for (const table of Object.values(LEGACY_IDS)) {
      for (const [old, now] of entries(table)) expect(old).not.toBe(now);
    }
  });

  it('passes current ids, unknown ids and non-strings through unchanged', () => {
    expect(migrateLegacyId('navProfile', 'dcc')).toBe('dcc');
    expect(migrateLegacyId('navProfile', 'trackpad')).toBe('trackpad');
    expect(migrateLegacyId('navProfile', 'joystick')).toBe('joystick');
    expect(migrateLegacyId('spaceBehaviour', 'play')).toBe('play');
    expect(migrateLegacyId('orientPreset', 'world')).toBe('world');
    expect(migrateLegacyId('navProfile', 'toString')).toBe('toString'); // own keys only, no prototype lookups
    expect(migrateLegacyId('navProfile', null)).toBeNull();
    expect(migrateLegacyId('navProfile', 3)).toBe(3);
    expect(migrateLegacyPrefs('garbage')).toBe('garbage');
    expect(migrateLegacyPrefs(null)).toBeNull();
  });
});

describe('stored preferences with renamed ids', () => {
  const defaults = defaultPrefs('other');
  /** A version-1 preferences value as an earlier build wrote it. */
  const stored = (patch: {
    readonly navProfile?: string;
    readonly spaceBehaviour?: string;
    readonly primitiveDefaults?: string;
    readonly orientPreset?: string;
  }): unknown => ({
    ...defaults,
    navProfile: patch.navProfile ?? defaults.navProfile,
    spaceBehaviour: patch.spaceBehaviour ?? defaults.spaceBehaviour,
    modeling: { ...defaults.modeling, primitiveDefaults: patch.primitiveDefaults ?? 'low-poly' },
    rigging: { ...defaults.rigging, orientPreset: patch.orientPreset ?? defaults.rigging.orientPreset },
  });

  it.each(entries(LEGACY_IDS.navProfile))('navProfile %s loads as %s', (old, now) => {
    expect(sanitizePrefs(stored({ navProfile: old }), defaultPrefs('mac')).navProfile).toBe(now);
  });

  it.each(entries(LEGACY_IDS.spaceBehaviour))('spaceBehaviour %s loads as %s', (old, now) => {
    expect(sanitizePrefs(stored({ spaceBehaviour: old }), { ...defaults, spaceBehaviour: 'play' }).spaceBehaviour).toBe(
      now,
    );
  });

  it.each(entries(LEGACY_IDS.primitiveDefaults))('modeling.primitiveDefaults %s loads as %s', (old, now) => {
    expect(sanitizePrefs(stored({ primitiveDefaults: old }), defaults).modeling.primitiveDefaults).toBe(now);
  });

  it.each(entries(LEGACY_IDS.orientPreset))('rigging.orientPreset %s loads as %s', (old, now) => {
    expect(sanitizePrefs(stored({ orientPreset: old }), { ...defaults }).rigging.orientPreset).toBe(now);
  });

  it('keeps every other field of an old value and writes only current ids back', () => {
    const [oldNav, nav] = entries(LEGACY_IDS.navProfile)[0] ?? ['', ''];
    const [oldSpace, space] = entries(LEGACY_IDS.spaceBehaviour)[0] ?? ['', ''];
    const [oldPrimitives, primitives] = entries(LEGACY_IDS.primitiveDefaults)[0] ?? ['', ''];
    const [oldOrient, orient] = entries(LEGACY_IDS.orientPreset)[1] ?? ['', ''];
    const old = {
      ...(stored({
        navProfile: oldNav,
        spaceBehaviour: oldSpace,
        primitiveDefaults: oldPrimitives,
        orientPreset: oldOrient,
      }) as Prefs),
      autoKey: true,
      uiScale: 1.25,
    };
    const storage = memoryStorage({ [PREFS_STORAGE_KEY]: JSON.stringify(old) });
    const loaded = loadPrefs(storage, defaultPrefs('mac'));
    expect(loaded).toMatchObject({
      navProfile: nav,
      spaceBehaviour: space,
      autoKey: true,
      uiScale: 1.25,
      modeling: { primitiveDefaults: primitives },
      rigging: { orientPreset: orient },
    });
    savePrefs(storage, loaded);
    const written = storage.data.get(PREFS_STORAGE_KEY) ?? '';
    for (const table of Object.values(LEGACY_IDS)) {
      for (const [oldId] of entries(table)) expect(written).not.toContain(`"${oldId}"`);
    }
    expect(loadPrefs(storage, defaultPrefs('mac'))).toEqual(loaded);
  });

  it('a missing or invalid renamed field still takes its default', () => {
    const value = { ...defaults, navProfile: undefined, spaceBehaviour: 'joystick' };
    expect(sanitizePrefs(value, defaultPrefs('mac'))).toMatchObject({
      navProfile: 'trackpad',
      spaceBehaviour: 'maximize',
    });
  });
});

describe('operator arguments with renamed ids', () => {
  it('maps only the listed arguments of the listed operators, copying the args only when one changes', () => {
    for (const [op, fields] of Object.entries(LEGACY_ARGS)) {
      for (const [key, field] of Object.entries(fields)) {
        for (const [old, now] of entries(LEGACY_IDS[field])) {
          const args = { [key]: old, other: old };
          expect(migrateLegacyArgs(op, args)).toEqual({ [key]: now, other: old });
          expect(args[key]).toBe(old); // the caller's object is not mutated
        }
      }
    }
    const current = { profile: 'dcc' };
    expect(migrateLegacyArgs('view.setNavProfile', current)).toBe(current);
    const [old] = Object.keys(LEGACY_IDS.navProfile);
    expect(migrateLegacyArgs('view.tool', { profile: old })).toEqual({ profile: old });
    expect(migrateLegacyArgs('view.setNavProfile', null)).toBeNull();
  });

  it.each(entries(LEGACY_IDS.navProfile))('view.setNavProfile {profile: %s} sets %s', async (old, now) => {
    const app = opsApp();
    await runOk(app, 'view.setNavProfile', { profile: old });
    expect(app.prefs.getState().navProfile).toBe(now);
  });
});

describe('skel.joint.orient with a renamed preset id', () => {
  /** The rest rotations a preset gives the left arm chain of a fresh Quick Rig. */
  const orientWith = async (preset: string): Promise<unknown> => {
    const t = await rigTestApp();
    const result = await t.app.runUntyped('skel.quickRig.commit', {
      preset: 'standard33',
      markers: truthMarkers(),
      meshes: [t.lad],
      flexion: DEFAULT_FLEXION,
    });
    if (result.status !== 'finished') throw new Error(JSON.stringify(result));
    const { skeleton } = result.value as { skeleton: SkeletonId };
    const arm = `${skeleton}:leftUpperArm` as JointId;
    expect((await t.app.runUntyped('skel.joint.orient', { joints: [arm], preset })).status).toBe('finished');
    return t.app.store.query.jointsOfSkeleton(skeleton).map((joint) => [joint.key, joint.restRotation]);
  };

  it.each(entries(LEGACY_IDS.orientPreset))('preset %s orients exactly like %s', async (old, now) => {
    expect(await orientWith(old)).toEqual(await orientWith(now));
  });
});
