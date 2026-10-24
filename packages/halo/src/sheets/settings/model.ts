// The Settings sheet's model (STUDIO-TOUCH-SPEC §15.14, §16.4, §5.1, §5.8, §18; T6b): React-free, so the tests run
// it over a headless app. The sections are `SHEET_SECTIONS.settings`; every one but Start in and the Advanced heading
// is generated from the preferences descriptor table (`PREF_DESCRIPTORS`, `PREF_SECTIONS`): one control per descriptor
// that is not hidden, by kind (boolean → toggle, enum → segments or a list, number → a scrub chip in the shown unit),
// with the plain label, Studio Pro's name in grey and the help line. A control writes through the call `prefWrite`
// builds (`prefs.set`, `rig.jointSize.set`, `skin.paint.set`), or through the named operator the Disclosure Manifest
// puts in its section (`view.setNavProfile` in Input, `key.toggleAutoKey` in Animation); the sheet runs it with
// `ctx.run`. A writer that is not registered yet (the Rig & Skin chunk) leaves the row with a plain note instead.
//
// - Shown values are the effective preferences (`app.prefs.getState()`): a session override — the device's memory
//   profile on iPad, later Halo's Rec — shows, with a note naming the user's own value (`basePrefs`).
// - The §16.4 shared preferences (`shared` in the table) are Studio Pro's too: their rows say so, and they change only
//   through their own control here.
import {
  basePrefs,
  type EditorApp,
  PREF_DESCRIPTORS,
  PREF_SECTIONS,
  type PrefDescriptor,
  type PrefOption,
  type PrefUnit,
  prefShownValue,
  prefStoredValue,
  prefValue,
  prefWrite,
} from '@ekza-studio/editor-core';
import { SHEET_SECTIONS } from '../../manifest/sheets';

export type ControlValue = boolean | string | number;

/** An operator call a control runs (the sheet passes it to `ctx.run`). */
export interface ControlWrite {
  readonly op: string;
  readonly args?: unknown;
}

/** How the view draws a control. `none`: no input (only Studio Pro edits it, or its writer is not loaded). */
export type ControlPresentation = 'toggle' | 'segments' | 'list' | 'number' | 'none';

export interface SettingsControl {
  /** Unique within the sheet: the descriptor path, or `op:<id>` for an operator control. */
  readonly key: string;
  /** The descriptor path; null for an operator control (Auto Key in Studio Pro). */
  readonly path: string | null;
  readonly label: string;
  /** Studio Pro's name for it (grey, one layer down, §1.3). */
  readonly proName: string | null;
  readonly help: string | null;
  readonly kind: 'boolean' | 'enum' | 'number' | 'other';
  readonly presentation: ControlPresentation;
  /** The shown value: the effective preference, numbers in the shown unit. */
  readonly value: ControlValue | null;
  readonly options: readonly PrefOption[];
  readonly unit: PrefUnit | null;
  /** Numbers: the control's range and step in the shown unit. */
  readonly range: { readonly min: number; readonly max: number; readonly step: number } | null;
  /** A §16.4 preference Studio Pro shares: its row says so. */
  readonly shared: boolean;
  /** The operator a write runs (null: nothing writes it from here). */
  readonly op: string | null;
  /** Why the control takes no input now (null: it does). */
  readonly disabledReason: string | null;
  /** A session override shows another value than the user's own (iPad's undo budgets), in plain words. */
  readonly note: string | null;
  /** The call that sets `value` (shown unit for numbers), or null (disabled, unchanged or not a valid value). */
  write(value: ControlValue): ControlWrite | null;
}

export type SettingsLink =
  /** A plain link (Start in: the chooser on the front page, in a new tab so the project stays open). */
  | { readonly kind: 'href'; readonly label: string; readonly href: string }
  /** Another sheet (Keyboard: the shortcut sheet in Help). */
  | { readonly kind: 'sheet'; readonly label: string; readonly sheet: 'help'; readonly section: string }
  /** A stage of the Path (Rig: its chunk registers the Rig writers). */
  | { readonly kind: 'stage'; readonly label: string; readonly stage: 'rig' };

export interface SettingsSection {
  /** A section of `SHEET_SECTIONS.settings`. */
  readonly id: string;
  readonly label: string;
  /** `advanced`: a group under the Advanced heading (`PREF_SECTIONS` page). */
  readonly page: 'settings' | 'advanced';
  readonly intro: string | null;
  readonly controls: readonly SettingsControl[];
  readonly links: readonly SettingsLink[];
  /** Where Halo's own settings mount (Input: `halo.input`, T6a's routing and gesture settings, §5.1, §18). */
  readonly slot: 'halo.input' | 'halo.time' | null;
}

/** Writers the manifest names for a descriptor's section, used instead of `prefs.set` (the same state). */
const OPERATOR_WRITERS: Readonly<
  Record<string, { readonly op: string; readonly args: (value: ControlValue) => Readonly<Record<string, unknown>> }>
> = {
  // Disclosure: `view.setNavProfile` → S('settings', 'input'); Studio Pro's View › Navigation runs the same operator.
  navProfile: { op: 'view.setNavProfile', args: (value) => ({ profile: value }) },
};

/** Operators registered with the Rig & Skin chunk (or the host's Rig registrations), not at boot. */
const RIG_WRITERS: ReadonlySet<string> = new Set(['rig.jointSize.set', 'skin.paint.set']);

const OPENS_WITH_RIG = 'Opens with Rig';
const NOT_HERE = 'Not available on this page';
const PRO_ONLY = 'Only Studio Pro changes this';

/** A list instead of segments: more than four choices, or choices too long for one row of a 360 px sheet. */
const SEGMENT_MAX_OPTIONS = 4;
const SEGMENT_MAX_LABEL = 14;

/** The operator a descriptor's control writes through (null: none from Settings). */
export function writerOf(descriptor: PrefDescriptor): string | null {
  const named = OPERATOR_WRITERS[descriptor.path];
  if (named !== undefined) return named.op;
  if (descriptor.writer === 'prefs.set' || RIG_WRITERS.has(descriptor.writer)) return descriptor.writer;
  return null;
}

function unitText(unit: PrefUnit | null): string {
  if (unit === null) return '';
  return unit === '°' ? '°' : ` ${unit}`;
}

/** A value as words for a note: an option's label, On / Off, or a number with its unit. */
function valueText(descriptor: PrefDescriptor, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') {
    return `${Number(prefShownValue(descriptor, value).toPrecision(6))}${unitText(descriptor.unit ?? null)}`;
  }
  const option = descriptor.options?.find((o) => o.value === value);
  return option?.label ?? String(value);
}

const DEVICE_BUDGETS: ReadonlySet<string> = new Set(['modeling.undoBudgetMB', 'modeling.journalBudgetMB']);

function overrideNote(descriptor: PrefDescriptor, effective: unknown, own: unknown): string | null {
  if (Object.is(effective, own) || own === undefined) return null;
  if (DEVICE_BUDGETS.has(descriptor.path)) {
    return `This device keeps ${valueText(descriptor, effective)} to stay within its memory; your ${valueText(descriptor, own)} applies on other devices.`;
  }
  return `Set to ${valueText(descriptor, effective)} in this layout for now; your own setting is ${valueText(descriptor, own)}.`;
}

function presentationOf(descriptor: PrefDescriptor): ControlPresentation {
  if (descriptor.kind === 'boolean') return 'toggle';
  if (descriptor.kind === 'number') return 'number';
  if (descriptor.kind === 'enum') {
    const options = descriptor.options ?? [];
    const long = options.some((option) => option.label.length > SEGMENT_MAX_LABEL);
    return options.length > SEGMENT_MAX_OPTIONS || long ? 'list' : 'segments';
  }
  return 'none';
}

function clamp(value: number, range: PrefDescriptor['range']): number {
  if (range === undefined) return value;
  return Math.min(range.max, Math.max(range.min, value));
}

/** One generated control (a descriptor that is not hidden). */
export function descriptorControl(app: EditorApp, descriptor: PrefDescriptor): SettingsControl {
  const state = app.prefs.getState();
  const effective = prefValue(state, descriptor.path);
  const own = prefValue(basePrefs(state), descriptor.path);
  const op = writerOf(descriptor);
  const presentation = presentationOf(descriptor);
  const registered = op !== null && app.operators.get(op) !== undefined;
  const disabledReason =
    op === null || presentation === 'none'
      ? PRO_ONLY
      : registered
        ? null
        : RIG_WRITERS.has(op)
          ? OPENS_WITH_RIG
          : NOT_HERE;
  const kind =
    descriptor.kind === 'boolean' || descriptor.kind === 'enum' || descriptor.kind === 'number'
      ? descriptor.kind
      : 'other';
  let value: ControlValue | null = null;
  if (typeof effective === 'boolean' || typeof effective === 'string') value = effective;
  else if (typeof effective === 'number') {
    const shown = prefShownValue(descriptor, effective);
    // Text & touch size: Studio Pro stores 0.5–3, both shells read it clamped to 85–150 % (§18), so show that.
    value = descriptor.path === 'uiScale' ? clamp(shown, descriptor.range) : shown;
  }
  const write = (next: ControlValue): ControlWrite | null => {
    if (disabledReason !== null || op === null) return null;
    let stored: unknown;
    if (kind === 'boolean') {
      if (typeof next !== 'boolean') return null;
      stored = next;
    } else if (kind === 'enum') {
      if (typeof next !== 'string' || !(descriptor.options ?? []).some((option) => option.value === next)) return null;
      stored = next;
    } else if (kind === 'number') {
      if (typeof next !== 'number' || !Number.isFinite(next)) return null;
      stored = prefStoredValue(descriptor, clamp(next, descriptor.range));
    } else {
      return null;
    }
    const named = OPERATOR_WRITERS[descriptor.path];
    if (named !== undefined) return { op: named.op, args: named.args(stored as ControlValue) };
    return prefWrite(app.prefs.getState(), descriptor.path, stored);
  };
  return {
    key: descriptor.path,
    path: descriptor.path,
    label: descriptor.label,
    proName: descriptor.proName ?? null,
    help: descriptor.help ?? null,
    kind,
    presentation: disabledReason === null ? presentation : 'none',
    value,
    options: descriptor.options ?? [],
    unit: descriptor.unit ?? null,
    range: descriptor.range ?? null,
    shared: descriptor.shared === true,
    op,
    disabledReason,
    note: overrideNote(descriptor, effective, own),
    write,
  };
}

/**
 * Auto Key in Studio Pro (§15.14 row 14.4, §16.4): the manifest's `key.toggleAutoKey` in Settings › Animation. The
 * `autoKey` descriptor is hidden (Halo's Rec overrides it for the session), so this row shows Studio Pro's own value
 * (`basePrefs`) and writes it by the toggle, which flips the stored value even while Rec holds the shown one (T6-INT:
 * the toggle reads the base, and a named scalar write lands in the base). A note says Rec keys here meanwhile.
 */
export function autoKeyControl(app: EditorApp): SettingsControl {
  const op = 'key.toggleAutoKey';
  const state = app.prefs.getState();
  const own = basePrefs(state).autoKey;
  const registered = app.operators.get(op) !== undefined;
  const disabledReason = !registered ? NOT_HERE : null;
  return {
    key: `op:${op}`,
    path: null,
    label: 'Auto Key in Studio Pro',
    proName: 'Auto Key',
    help: 'Keys what you change while you work in Studio Pro. Here, Rec on the Thread does that.',
    kind: 'boolean',
    presentation: disabledReason === null ? 'toggle' : 'none',
    value: own,
    options: [],
    unit: null,
    range: null,
    shared: true,
    op,
    disabledReason,
    note: own === state.autoKey ? null : 'Rec keys in this layout for now; this is what Studio Pro does.',
    write: (next) => (disabledReason !== null || typeof next !== 'boolean' || next === own ? null : { op }),
  };
}

/** Hidden descriptors the manifest still shows, as an operator control at the descriptor's place. */
const OPERATOR_CONTROLS: Readonly<Record<string, (app: EditorApp) => SettingsControl>> = {
  autoKey: autoKeyControl,
};

const SECTION_LABEL: Readonly<Record<string, string>> = { startIn: 'Start in', advanced: 'Advanced' };

/** Halo's own keys in one line (§5.8), in the platform's key names. */
function haloKeysLine(app: EditorApp): string {
  const search = app.keymap.label({ code: 'KeyK', mod: true });
  const stage = app.keymap.label({ code: 'Digit1', ctrl: true });
  return `Here Space always plays, ${search} or / searches and ${stage}–4 switch stages.`;
}

function sectionExtras(app: EditorApp, id: string, controls: readonly SettingsControl[]): Partial<SettingsSection> {
  switch (id) {
    case 'startIn':
      return {
        intro:
          'The front page opens the layout it was asked to remember, or lets you choose. Choose there and tick Remember; untick it to be asked again. Studio Pro has the same choice in Preferences › Start in.',
        links: [{ kind: 'href', label: 'Open the chooser ▸', href: '/?chooser=1' }],
      };
    case 'input':
      return { slot: 'halo.input' };
    case 'animation':
      // Settings › Time (§10.3, ST-T7-UNIT): the frame's `halo.time` row (T7's `thread/TimeSettings`)
      return { slot: 'halo.time' };
    case 'keyboard':
      return {
        intro: haloKeysLine(app),
        links: [{ kind: 'sheet', label: 'All shortcuts ▸', sheet: 'help', section: 'shortcuts' }],
      };
    case 'advanced':
      return { intro: 'Every other setting, from the same list Studio Pro reads.' };
    case 'rigging':
      return controls.some((control) => control.disabledReason === OPENS_WITH_RIG)
        ? { links: [{ kind: 'stage', label: 'Switch to Rig ▸', stage: 'rig' }] }
        : {};
    default:
      return {};
  }
}

/** The controls of one descriptor section, in table order. */
function sectionControls(app: EditorApp, id: string): readonly SettingsControl[] {
  const out: SettingsControl[] = [];
  for (const descriptor of PREF_DESCRIPTORS) {
    if (descriptor.section !== id) continue;
    const stand = OPERATOR_CONTROLS[descriptor.path];
    if (stand !== undefined) out.push(stand(app));
    else if (descriptor.hidden === undefined) out.push(descriptorControl(app, descriptor));
  }
  return out;
}

/** Every section of the Settings sheet, in `SHEET_SECTIONS.settings` order. */
export function settingsSections(app: EditorApp): readonly SettingsSection[] {
  return (SHEET_SECTIONS.settings ?? []).map((id): SettingsSection => {
    const def = PREF_SECTIONS.find((section) => section.id === id);
    const controls = def === undefined ? [] : sectionControls(app, id);
    return {
      id,
      label: SECTION_LABEL[id] ?? def?.label ?? id,
      page: def?.page === 'advanced' ? 'advanced' : 'settings',
      intro: null,
      links: [],
      slot: null,
      controls,
      ...sectionExtras(app, id, controls),
    };
  });
}

/** Every control of the sheet with its section id. */
export function settingsControls(
  app: EditorApp,
): readonly { readonly section: string; readonly control: SettingsControl }[] {
  return settingsSections(app).flatMap((section) =>
    section.controls.map((control) => ({ section: section.id, control })),
  );
}

/** The grey line under a control's label: Studio Pro's name, and whether Studio Pro shares it (§1.3, §16.4). */
export function proLine(control: SettingsControl): string {
  const parts: string[] = [];
  if (control.proName !== null) parts.push(control.proName);
  if (control.shared) parts.push(parts.length === 0 ? "Also Studio Pro's setting" : "also Studio Pro's setting");
  return parts.join(' · ');
}
