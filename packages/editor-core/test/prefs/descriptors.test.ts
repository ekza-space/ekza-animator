// The preferences descriptor table (STUDIO-TOUCH-SPEC §15 row 14.7, §20.3 item 19; T6b): every leaf of the defaults
// has exactly one descriptor and every descriptor names a leaf that exists; numeric defaults lie inside their range
// (in the shown unit) and on its step; enum defaults are among the options; labels are unique per section; every
// control has a writer the host accepts (`prefs.set` only for keys of its allow-list, or a named operator); the values
// a control can write survive the persistence's validation; `prefPatch` round-trips, also under session overrides;
// and the §16.4 shared preferences are flagged. Table-wide checks collect every offending path, so a failure names
// them all.
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import {
  basePrefs,
  defaultPrefs,
  type OperatorMap,
  overridePrefs,
  PREF_DESCRIPTORS,
  PREF_SECTIONS,
  type PrefDescriptor,
  type Prefs,
  prefDescriptor,
  prefLeafPaths,
  prefPatch,
  prefShownValue,
  prefStoredValue,
  prefValue,
  prefWrite,
} from '../../src';
import { brushPatch } from '../../src/operators/builtin/rig/influence';
import { sanitizePrefs } from '../../src/prefs/persist';

/**
 * The host's `prefs.set` allow-list, copied as data from `PREF_KEYS` in `packages/editor/src/host/operators.ts`
 * (editor-core cannot import the editor package). `rigging` is in it since T6-INT (Studio Pro's status-line joint size,
 * the option boxes' *Make default*); the rigging settings with a named operator still write through it.
 */
const PREF_KEYS: ReadonlySet<string> = new Set([
  'firstRunDone',
  'navProfile',
  'spaceBehaviour',
  'keymapOverrides',
  'defaultTangents',
  'autoKey',
  'autoKeyMode',
  'graphHandles',
  'moveSpace',
  'rotateSpace',
  'reduceOnImport',
  'uiScale',
  'autoRigIk',
  'ikFkVisibility',
  'ikFkSwitchKey',
  'tweenOvershoot',
  'arrowKeys',
  'virtualSlider',
  'exportReduce',
  'autosave',
  'lastWorkspace',
  'modeling',
  'rigging',
]);

/** Named writers registered by editor-core (typed against its operator map). */
const CORE_WRITERS = [
  'skin.paint.set',
  'skin.influence.hold',
  'workspace.set',
] as const satisfies readonly (keyof OperatorMap)[];
/** Named writers the page host registers (`packages/editor/src/shell/rig/operators.ts`, `JOINT_SIZE` 0.25–4). */
const HOST_WRITERS = ['rig.jointSize.set'] as const;
const NAMED_WRITERS: ReadonlySet<string> = new Set<string>([...CORE_WRITERS, ...HOST_WRITERS]);

/** §16.4: the Studio Pro preferences Ekza Studio never writes implicitly. */
const SHARED = ['navProfile', 'autoKey', 'spaceBehaviour', 'modeling.optionDefaults', 'uiScale'];

/** The iOS memory profile's budgets (`IOS_MEMORY` in `packages/editor/src/host/memoryProfile.ts`). */
const IOS_BUDGETS: ReadonlyMap<string, number> = new Map([
  ['modeling.undoBudgetMB', 96],
  ['modeling.journalBudgetMB', 24],
]);

const PLATFORMS = ['mac', 'other'] as const;
const DEFAULTS = defaultPrefs('other');

type Plain = Readonly<Record<string, unknown>>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The structural leaves of a value, independent of the table: non-empty plain objects recurse, the rest are leaves. */
function structuralLeaves(value: unknown, path = ''): string[] {
  if (path !== '' && (!isPlain(value) || Object.keys(value).length === 0)) return [path];
  return Object.entries(value as Plain).flatMap(([key, child]) =>
    path === '' && key === 'version' ? [] : structuralLeaves(child, path === '' ? key : `${path}.${key}`),
  );
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();
const topKey = (path: string): string => path.split('.')[0] ?? path;
const duplicates = (values: readonly string[]): string[] => values.filter((value, i) => values.indexOf(value) !== i);
const numbers = PREF_DESCRIPTORS.filter((d) => d.kind === 'number');
const enums = PREF_DESCRIPTORS.filter((d) => d.kind === 'enum');
const controls = PREF_DESCRIPTORS.filter((d) => d.hidden === undefined);

/** `problem` for each descriptor where `check` returns one (a string), for one `toEqual([])`. */
function problems(descriptors: readonly PrefDescriptor[], check: (d: PrefDescriptor) => string | null): string[] {
  return descriptors.flatMap((d) => {
    const problem = check(d);
    return problem === null ? [] : [`${d.path}: ${problem}`];
  });
}

/** The values a control can write: range ends (stored unit), every option, both booleans. */
function writableValues(d: PrefDescriptor): unknown[] {
  if (d.kind === 'boolean') return [true, false];
  if (d.kind === 'enum') return (d.options ?? []).map((option) => option.value);
  if (d.kind === 'number' && d.range !== undefined) {
    return [prefStoredValue(d, d.range.min), prefStoredValue(d, d.range.max)];
  }
  return [];
}

/** A value other than the default, of the descriptor's kind. */
function otherValue(d: PrefDescriptor, current: unknown): unknown {
  switch (d.kind) {
    case 'boolean':
      return current !== true;
    case 'enum':
      return (d.options ?? []).map((option) => option.value).find((value) => value !== current);
    case 'number':
      return d.range === undefined ? 1 : prefStoredValue(d, d.range.max);
    case 'text':
      return 'model';
    case 'list':
      return ['probe'];
    case 'record':
      return { probe: {} };
  }
}

const close = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)) : false;
const same = (a: unknown, b: unknown): boolean => close(a, b) || JSON.stringify(a) === JSON.stringify(b);

describe('coverage', () => {
  it.each(PLATFORMS)('every leaf of the %s defaults has exactly one descriptor, and no descriptor more', (platform) => {
    const defaults = defaultPrefs(platform);
    const paths = PREF_DESCRIPTORS.map((d) => d.path);
    expect(duplicates(paths)).toEqual([]);
    expect(sorted(paths)).toEqual(sorted(structuralLeaves(defaults)));
    expect(sorted(prefLeafPaths(defaults))).toEqual(sorted(paths));
    expect(paths.filter((path) => prefValue(defaults, path) === undefined)).toEqual([]);
  });

  it('covers every top-level key except version', () => {
    const keys = Object.keys(DEFAULTS).filter((key) => key !== 'version');
    expect(keys.length).toBeGreaterThan(20);
    expect(sorted(new Set(PREF_DESCRIPTORS.map((d) => topKey(d.path))))).toEqual(sorted(keys));
  });

  it('keeps records keyed by user data whole and reports stored keys the defaults lack', () => {
    const prefs: Prefs = {
      ...DEFAULTS,
      modeling: {
        ...DEFAULTS.modeling,
        undoSelection: { ...DEFAULTS.modeling.undoSelection, review: true },
        optionDefaults: { 'mesh.bevel': { segments: 2 } },
      },
      rigging: { ...DEFAULTS.rigging, holds: { 'p/c': ['hips'] }, influenceColours: { hips: '#ff0000' } },
    };
    const leaves = prefLeafPaths(prefs);
    expect(leaves).toContain('rigging.holds');
    expect(leaves).toContain('rigging.influenceColours');
    expect(leaves).toContain('modeling.optionDefaults');
    expect(leaves.filter((path) => /^(rigging\.holds|modeling\.optionDefaults)\./.test(path))).toEqual([]);
    expect(leaves).toContain('modeling.undoSelection.review');
    expect(prefDescriptor('modeling.undoSelection.review')).toBeUndefined();
    expect(leaves).not.toContain('version');
  });

  it('places every descriptor in a known section; internal ones are hidden, controls have a help sentence', () => {
    const ids = PREF_SECTIONS.map((section) => section.id);
    expect(duplicates(ids)).toEqual([]);
    expect(duplicates(PREF_SECTIONS.map((section) => section.label))).toEqual([]);
    expect(problems(PREF_DESCRIPTORS, (d) => (ids.includes(d.section) ? null : 'unknown section'))).toEqual([]);
    const internal = PREF_DESCRIPTORS.filter((d) => d.section === 'internal');
    expect(problems(internal, (d) => (d.hidden === undefined ? 'internal but not hidden' : null))).toEqual([]);
    expect(problems(controls, (d) => (/^[A-Z].*\.$/.test(d.help ?? '') ? null : 'no help sentence'))).toEqual([]);
    // Settings › Advanced is generated from the sections it groups (§15 row 14.7).
    const advanced = PREF_SECTIONS.filter((section) => section.page === 'advanced').map((section) => section.id);
    expect(controls.filter((d) => advanced.includes(d.section)).length).toBeGreaterThan(10);
  });
});

describe('values', () => {
  it('matches each kind to its default value and its fields', () => {
    const kindOf = (value: unknown): string[] => {
      if (typeof value === 'boolean') return ['boolean'];
      if (typeof value === 'number') return ['number'];
      if (typeof value === 'string') return ['enum', 'text'];
      if (Array.isArray(value)) return ['list'];
      return isPlain(value) ? ['record'] : [];
    };
    expect(
      problems(PREF_DESCRIPTORS, (d) => (kindOf(prefValue(DEFAULTS, d.path)).includes(d.kind) ? null : 'wrong kind')),
    ).toEqual([]);
    expect(
      problems(PREF_DESCRIPTORS, (d) => ((d.options !== undefined) === (d.kind === 'enum') ? null : 'options')),
    ).toEqual([]);
    expect(
      problems(PREF_DESCRIPTORS, (d) => {
        const numeric = d.range !== undefined && d.unit !== undefined;
        return numeric === (d.kind === 'number') ? null : 'range and unit';
      }),
    ).toEqual([]);
  });

  it.each(PLATFORMS)('keeps every %s numeric default inside its range, on the step grid', (platform) => {
    const defaults = defaultPrefs(platform);
    expect(numbers.length).toBeGreaterThan(20);
    const offRange = problems(numbers, (d) => {
      const range = d.range;
      if (range === undefined || !(range.min < range.max) || !(range.step > 0)) return 'bad range';
      const ios = IOS_BUDGETS.get(d.path);
      const stored = [prefValue(defaults, d.path) as number, ...(ios === undefined ? [] : [ios])];
      for (const value of stored) {
        const shown = prefShownValue(d, value);
        if (shown < range.min || shown > range.max) return `${shown} outside ${range.min}…${range.max}`;
        const steps = (shown - range.min) / range.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) return `${shown} off the ${range.step} step`;
      }
      return null;
    });
    expect(offRange).toEqual([]);
  });

  it.each(PLATFORMS)('lists every %s enum default among the options, values and labels once each', (platform) => {
    const defaults = defaultPrefs(platform);
    expect(
      problems(enums, (d) => {
        const values = (d.options ?? []).map((option) => option.value);
        const labels = (d.options ?? []).map((option) => option.label);
        if (duplicates(values).length > 0 || duplicates(labels).length > 0) return 'duplicate option';
        return values.includes(prefValue(defaults, d.path) as string) ? null : 'default not an option';
      }),
    ).toEqual([]);
  });

  it('converts the shown units both ways', () => {
    const shown = (path: string): number =>
      prefShownValue(prefDescriptor(path) as PrefDescriptor, prefValue(DEFAULTS, path) as number);
    expect(shown('modeling.increments.rotate')).toBe(15);
    expect(shown('autosave.delayMs')).toBe(2);
    expect(shown('uiScale')).toBe(100);
    expect(shown('exportReduce.rotationCapRad')).toBe(0.25);
    expect(shown('exportReduce.positionM')).toBe(0.2);
    expect(shown('modeling.multiCutSnapStep')).toBe(25);
    expect(shown('modeling.gridStep')).toBe(0.1);
    expect(
      problems(numbers, (d) => {
        const stored = prefValue(DEFAULTS, d.path) as number;
        return close(prefStoredValue(d, prefShownValue(d, stored)), stored) ? null : 'does not round-trip';
      }),
    ).toEqual([]);
  });
});

describe('labels', () => {
  it('are unique within a section and trimmed', () => {
    const repeated = PREF_SECTIONS.flatMap((section) =>
      duplicates(PREF_DESCRIPTORS.filter((d) => d.section === section.id).map((d) => d.label)).map(
        (label) => `${section.id}: ${label}`,
      ),
    );
    expect(repeated).toEqual([]);
    expect(problems(PREF_DESCRIPTORS, (d) => (d.label !== '' && d.label.trim() === d.label ? null : 'label'))).toEqual(
      [],
    );
  });

  it('use plain words for controls; Pro names stay in proName (§1.3)', () => {
    const jargon = /\b(IK|FK|tangents?|manipulator|gimbal|vert(ex|ices)|influences?|pick ?walk|MMB|Graph Editor)\b/i;
    expect(problems(controls, (d) => (jargon.test(d.label) ? 'jargon' : null))).toEqual([]);
  });
});

describe('writers', () => {
  it('give every control a writer the host accepts, and prefWrite builds its call', () => {
    expect(
      problems(controls, (d) => {
        if (d.writer === 'none') return 'no writer';
        if (d.writer === 'prefs.set') return PREF_KEYS.has(topKey(d.path)) ? null : 'not in PREF_KEYS';
        return NAMED_WRITERS.has(d.writer) ? null : 'unknown operator';
      }),
    ).toEqual([]);
    expect(
      problems(controls, (d) =>
        prefWrite(DEFAULTS, d.path, prefValue(DEFAULTS, d.path))?.op === d.writer ? null : 'prefWrite',
      ),
    ).toEqual([]);
  });

  it('claim prefs.set only for keys of its allow-list, and name only known operators', () => {
    expect(
      problems(PREF_DESCRIPTORS, (d) => {
        if (d.writer === 'none') return null;
        if (d.writer === 'prefs.set') return PREF_KEYS.has(topKey(d.path)) ? null : 'not in PREF_KEYS';
        return NAMED_WRITERS.has(d.writer) ? null : 'unknown operator';
      }),
    ).toEqual([]);
  });

  it('record how each rigging preference is written; the ones without a writer are hidden', () => {
    const rigging = PREF_DESCRIPTORS.filter((d) => topKey(d.path) === 'rigging');
    expect(Object.fromEntries(rigging.map((d) => [d.path, d.writer]))).toEqual({
      'rigging.jointSize': 'rig.jointSize.set',
      'rigging.brush.op': 'skin.paint.set',
      'rigging.brush.value': 'skin.paint.set',
      'rigging.brush.opacity': 'skin.paint.set',
      'rigging.brush.radiusPx': 'skin.paint.set',
      'rigging.brush.falloff': 'skin.paint.set',
      'rigging.brush.reach': 'skin.paint.set',
      'rigging.brush.frontOnly': 'skin.paint.set',
      'rigging.brush.mirror': 'none',
      'rigging.influenceSort': 'none',
      'rigging.influenceColours': 'none',
      'rigging.optionDefaults': 'none',
      'rigging.orientPreset': 'none',
      'rigging.holds': 'skin.influence.hold',
    });
    const unwritable = rigging.filter((d) => d.writer === 'none');
    expect(problems(unwritable, (d) => (d.hidden === undefined ? 'shown without a writer' : null))).toEqual([]);
  });

  it('build the calls of the named writers', () => {
    expect(prefWrite(DEFAULTS, 'rigging.jointSize', 2)).toEqual({ op: 'rig.jointSize.set', args: { size: 2 } });
    expect(prefWrite(DEFAULTS, 'rigging.brush.radiusPx', 60)).toEqual({
      op: 'skin.paint.set',
      args: { patch: { radiusPx: 60 } },
    });
    expect(prefWrite(DEFAULTS, 'modeling.gridStep', 0.5)).toEqual({
      op: 'prefs.set',
      args: { patch: { modeling: { ...DEFAULTS.modeling, gridStep: 0.5 } } },
    });
    expect(prefWrite(DEFAULTS, 'rigging.influenceSort', 'alpha')).toBeNull();
    expect(prefWrite(DEFAULTS, 'rigging.holds', {})).toBeNull();
    expect(prefWrite(DEFAULTS, 'nope', 1)).toBeNull();
  });

  it('pass every brush value a control can write through skin.paint.set unchanged', () => {
    const brush = controls.filter((d) => d.writer === 'skin.paint.set');
    expect(brush.map((d) => d.path.slice('rigging.brush.'.length))).toEqual([
      'op',
      'value',
      'opacity',
      'radiusPx',
      'falloff',
      'reach',
      'frontOnly',
    ]);
    expect(
      problems(brush, (d) => {
        const field = d.path.slice('rigging.brush.'.length);
        const changed = writableValues(d).filter(
          (value) => !same(brushPatch({ [field]: value }, 'replace'), { [field]: value }),
        );
        return changed.length === 0 ? null : `changes ${changed.map(String).join(', ')}`;
      }),
    ).toEqual([]);
  });

  it('flags exactly the §16.4 shared preferences', () => {
    expect(sorted(PREF_DESCRIPTORS.filter((d) => d.shared === true).map((d) => d.path))).toEqual(sorted(SHARED));
  });
});

describe('prefPatch', () => {
  it('round-trips every path over the defaults and leaves every other leaf alone', () => {
    expect(
      problems(PREF_DESCRIPTORS, (d) => {
        const value = otherValue(d, prefValue(DEFAULTS, d.path));
        if (value === undefined) return 'no other value';
        const patch = prefPatch(DEFAULTS, d.path, value);
        if (Object.keys(patch).join() !== topKey(d.path)) return `patches ${Object.keys(patch).join()}`;
        const next = { ...DEFAULTS, ...patch } as Prefs;
        if (!same(prefValue(next, d.path), value)) return 'does not read back';
        const moved = PREF_DESCRIPTORS.filter(
          (other) => other.path !== d.path && !same(prefValue(next, other.path), prefValue(DEFAULTS, other.path)),
        );
        return moved.length === 0 ? null : `also changes ${moved.map((other) => other.path).join(', ')}`;
      }),
    ).toEqual([]);
  });

  it('writes values that survive the persistence (range ends, every option, both booleans)', () => {
    expect(
      problems(controls, (d) => {
        const lost = writableValues(d).filter((value) => {
          const next = { ...DEFAULTS, ...prefPatch(DEFAULTS, d.path, value) } as Prefs;
          const loaded = sanitizePrefs(JSON.parse(JSON.stringify(next)) as unknown, DEFAULTS);
          return !same(prefValue(loaded, d.path), value);
        });
        return lost.length === 0 ? null : `lost on load: ${lost.map(String).join(', ')}`;
      }),
    ).toEqual([]);
  });

  it('keeps the base of an overridden field when it writes a neighbour (§16.4)', () => {
    const store = createStore<Prefs>()(() => DEFAULTS);
    const dispose = overridePrefs(store, 'device', { modeling: { undoBudgetMB: 96 } });
    store.setState(prefPatch(store.getState(), 'modeling.gridStep', 0.5));
    expect(store.getState().modeling.gridStep).toBe(0.5);
    expect(store.getState().modeling.undoBudgetMB).toBe(96);
    expect(basePrefs(store.getState()).modeling.undoBudgetMB).toBe(256);
    dispose();
    expect(store.getState().modeling).toEqual({ ...DEFAULTS.modeling, gridStep: 0.5 });
  });

  it('refuses version and unknown keys; prefValue of a missing path is undefined', () => {
    expect(() => prefPatch(DEFAULTS, 'version', 2)).toThrow(/Unknown preference/);
    expect(() => prefPatch(DEFAULTS, 'nope.x', 1)).toThrow(/Unknown preference/);
    expect(prefValue(DEFAULTS, 'nope.x')).toBeUndefined();
    expect(prefValue(DEFAULTS, 'uiScale.x')).toBeUndefined();
  });
});
