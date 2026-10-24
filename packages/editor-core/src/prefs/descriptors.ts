// The preferences descriptor table (STUDIO-TOUCH-SPEC §15 row 14.7, §20.3 item 19; T6b): a label, section, kind,
// unit, range and writer for every leaf of `Prefs` (MVP-SPEC §4.5, M2A-SPEC §4.5, M6A-SPEC §4.6, M6B-SPEC §4.6), so
// Ekza Studio's Settings sheet — Settings › Advanced in particular — is generated from data, and Studio Pro can follow.
// Data and small pure helpers only: no React, no store access.
//
// - **Paths** are dotted leaf paths (`'uiScale'`, `'modeling.gridStep'`, `'rigging.brush.radiusPx'`). Nested objects
//   whose keys the defaults fix are split into leaves (`defaultTangents.in`, `modeling.undoSelection.rig`); records
//   keyed by user data (`modeling.optionDefaults`, `rigging.holds`, `rigging.influenceColours`) and lists are one
//   descriptor each. `version` has none. The test checks that every leaf of the defaults has exactly one descriptor,
//   and the table type below fails to compile when a top-level `Prefs` key has no entry.
// - **Labels** are plain words in the Halo vocabulary (§1.3: *Move* only for translation, *Turn* for rotation,
//   *Animation* only for a clip, *Add* only for new content, *Numbers* for the Inspector); Studio Pro's own label for
//   the same setting, where it has one, is `proName`. They are English defaults: Halo's string catalogue can key its
//   strings by `path`.
// - **Units and ranges** are in the shown unit; `display` converts a stored value to it (radians shown as degrees,
//   milliseconds as seconds, fractions and factors as percent, metres as millimetres). `range` is the control's range,
//   which may be narrower than what loading accepts (`uiScale`: 0.85–1.5 shown, 0.5–3 stored by Studio Pro, §18).
// - **Writers**: a control writes through `prefs.set` (the host's operator, whose allow-list takes top-level keys and
//   has no `rigging`), or through the named operator that owns the setting (`rig.jointSize.set`, `skin.paint.set`), or
//   not at all (`'none'`: only Studio Pro's own panels write the store directly). `prefWrite` builds the call.
// - **Hidden** descriptors are not controls: internal bookkeeping, settings with their own control elsewhere, and
//   settings nothing can write from Settings yet. **Shared** marks the Studio Pro preferences that Ekza Studio never
//   writes implicitly (§16.4): only their own control changes them.
import { EkzaError, type TangentType } from '@ekza-studio/anim-core';
import type { OperatorId, Prefs } from '../types';

/** Where a preference shows in Ekza Studio's Settings sheet (`PREF_SECTIONS` places each one). */
export type PrefSection =
  | 'input'
  | 'keyboard'
  | 'display'
  | 'animation'
  | 'import'
  | 'transform'
  | 'modeling'
  | 'rigging'
  | 'export'
  | 'undo'
  | 'autosave'
  | 'internal';

/** The value kind of a descriptor: `record` and `list` are edited as a whole (never field by field). */
export type PrefKind = 'boolean' | 'enum' | 'number' | 'text' | 'list' | 'record';

/** The shown unit of a number. */
export type PrefUnit = 'm' | 'mm' | '°' | 'px' | 'MB' | 's' | '×' | '%' | 'deg/px' | 'm/px' | 'units/px';

/** A conversion from the stored unit to the shown one ('fraction-as-percent' also shows a factor: 1 = 100 %). */
export type PrefDisplay = 'radians-as-degrees' | 'ms-as-seconds' | 'fraction-as-percent' | 'metres-as-millimetres';

/** One choice of an enum preference. */
export interface PrefOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The dotted path of every leaf and nested object of `Prefs` (without `version`); a record keyed by user data also
 * admits `<path>.<key>`. Descriptor paths are typed against it, so a misspelt path does not compile.
 */
export type PrefPath = PathsOf<Omit<Prefs, 'version'>>;

type PathsOf<T> = {
  readonly [K in keyof T & string]: T[K] extends readonly unknown[]
    ? K
    : T[K] extends object
      ? string extends keyof T[K]
        ? K | `${K}.${string}`
        : K | `${K}.${PathsOf<T[K]>}`
      : K;
}[keyof T & string];

/** One preference: what a generated Settings control needs to show and write it. */
export interface PrefDescriptor {
  /** The dotted leaf path (`'modeling.gridStep'`). */
  readonly path: PrefPath;
  /** Plain words (Halo vocabulary, §1.3). Unique within the section. */
  readonly label: string;
  /** Studio Pro's label for the same setting (its Preferences row, menu item or panel control), when it has one. */
  readonly proName?: string;
  readonly section: PrefSection;
  readonly kind: PrefKind;
  /** Numbers: the shown unit. */
  readonly unit?: PrefUnit;
  /** Numbers: the control's range and step, in the shown unit. */
  readonly range?: { readonly min: number; readonly max: number; readonly step: number };
  /** Enums: the choices, in the order a control lists them. */
  readonly options?: readonly PrefOption[];
  /** Numbers whose stored unit differs from the shown one. */
  readonly display?: PrefDisplay;
  /** Why it is not a control in Settings (absent: it is one). */
  readonly hidden?: string;
  /**
   * How a control writes it: `'prefs.set'` with the top-level key (the host's allow-list), a named operator (see
   * `prefWrite` for its arguments), or `'none'` when no operator writes it. Hidden descriptors record their writer
   * for reference.
   */
  readonly writer: OperatorId | 'none';
  /** A Studio Pro preference Ekza Studio never writes implicitly (§16.4): only its own control changes it. */
  readonly shared?: true;
  /** One plain sentence for the control's help line. */
  readonly help?: string;
}

/** A section of the Settings sheet: its own page, a group of Settings › Advanced, or nowhere (`internal`). */
export interface PrefSectionDef {
  readonly id: PrefSection;
  readonly label: string;
  readonly page: 'settings' | 'advanced' | 'none';
}

/** The sections in display order. Start in and Time are Ekza Studio's own settings, not `Prefs` (§15 row 14.1). */
export const PREF_SECTIONS: readonly PrefSectionDef[] = [
  { id: 'input', label: 'Input', page: 'settings' },
  { id: 'keyboard', label: 'Keyboard', page: 'settings' },
  { id: 'display', label: 'Display', page: 'settings' },
  { id: 'animation', label: 'Animation', page: 'settings' },
  { id: 'import', label: 'Import', page: 'settings' },
  { id: 'transform', label: 'Move and turn', page: 'advanced' },
  { id: 'modeling', label: 'Make', page: 'advanced' },
  { id: 'rigging', label: 'Rig', page: 'advanced' },
  { id: 'export', label: 'Export', page: 'advanced' },
  { id: 'undo', label: 'Undo', page: 'advanced' },
  { id: 'autosave', label: 'Autosave', page: 'advanced' },
  { id: 'internal', label: 'Internal', page: 'none' },
];

/** The tangent types (anim-core `TangentType`), in the order of Studio Pro's Graph Editor toolbar. */
const TANGENT_OPTIONS: readonly (PrefOption & { readonly value: TangentType })[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'spline', label: 'Spline' },
  { value: 'clamped', label: 'Clamped' },
  { value: 'linear', label: 'Linear' },
  { value: 'flat', label: 'Flat' },
  { value: 'step', label: 'Stepped' },
  { value: 'stepNext', label: 'Stepped next' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'plateau', label: 'Plateau' },
  { value: 'autoEase', label: 'Auto ease' },
  { value: 'autoMix', label: 'Auto mix' },
];

const NO_RIGGING_KEY = '`prefs.set` refuses `rigging`';

type TopKey = Exclude<keyof Prefs, 'version'>;
type Under<K extends TopKey> = Extract<PrefPath, K | `${K}.${string}`>;

/** Every top-level key's descriptors: a key missing here, or a path outside its key, does not compile. */
const TABLE: { readonly [K in TopKey]: readonly (PrefDescriptor & { readonly path: Under<K> })[] } = {
  firstRunDone: [
    {
      path: 'firstRunDone',
      label: 'Welcome shown',
      section: 'internal',
      kind: 'boolean',
      hidden: "Bookkeeping of Studio Pro's welcome dialog; Ekza Studio opens on Home instead (§15 row 14.8).",
      writer: 'prefs.set',
    },
  ],
  navProfile: [
    {
      path: 'navProfile',
      label: 'Mouse and trackpad',
      proName: 'Navigation',
      section: 'input',
      kind: 'enum',
      options: [
        { value: 'dcc', label: 'Mouse: Alt + drag' },
        { value: 'trackpad', label: 'Trackpad: scroll and pinch' },
        { value: 'oneButton', label: 'One-button mouse: Option + drag' },
      ],
      writer: 'prefs.set',
      shared: true,
      help: 'How a mouse or trackpad drives the view; touch and Pencil have their own settings.',
    },
  ],
  spaceBehaviour: [
    {
      path: 'spaceBehaviour',
      label: 'In Studio Pro, Space',
      proName: 'Space key',
      section: 'keyboard',
      kind: 'enum',
      options: [
        { value: 'maximize', label: 'Maximizes the panel under the pointer' },
        { value: 'play', label: 'Plays and stops' },
      ],
      writer: 'prefs.set',
      shared: true,
      help: 'Space always plays in Ekza Studio; this sets what it does in Studio Pro.',
    },
  ],
  keymapOverrides: [
    {
      path: 'keymapOverrides',
      label: 'Changed shortcuts',
      section: 'keyboard',
      kind: 'list',
      hidden:
        "Studio Pro's changed key bindings, synced from its keymap; neither layout edits them yet (§15 row 14.9).",
      writer: 'none',
    },
  ],
  defaultTangents: [
    {
      path: 'defaultTangents.in',
      label: 'New keys ease in',
      section: 'animation',
      kind: 'enum',
      options: TANGENT_OPTIONS,
      writer: 'prefs.set',
      help: 'The curve shape coming into each key you set.',
    },
    {
      path: 'defaultTangents.out',
      label: 'New keys ease out',
      section: 'animation',
      kind: 'enum',
      options: TANGENT_OPTIONS,
      writer: 'prefs.set',
      help: 'The curve shape leaving each key you set.',
    },
  ],
  autoKey: [
    {
      path: 'autoKey',
      label: 'Auto key in Studio Pro',
      proName: 'Auto Key',
      section: 'animation',
      kind: 'boolean',
      hidden: "Ekza Studio's Rec (`halo.rec`) overrides it for the session; Studio Pro's Auto Key writes it (§16.4).",
      writer: 'prefs.set',
      shared: true,
    },
  ],
  autoKeyMode: [
    {
      path: 'autoKeyMode',
      label: 'Rec keys',
      proName: 'Auto key',
      section: 'animation',
      kind: 'enum',
      options: [
        { value: 'keyed-only', label: 'Only channels that already have keys' },
        { value: 'all', label: 'Every channel you change' },
      ],
      writer: 'prefs.set',
      help: 'Which channels get a key when Rec is on and you change a pose.',
    },
  ],
  graphHandles: [
    {
      path: 'graphHandles',
      label: 'Handles on curves',
      proName: 'Graph Editor handles',
      section: 'animation',
      kind: 'enum',
      options: [
        { value: 'selected', label: 'Selected keys only' },
        { value: 'all', label: 'Every key' },
      ],
      writer: 'prefs.set',
      help: 'Which keys show their handles in Curves.',
    },
  ],
  moveSpace: [
    {
      path: 'moveSpace',
      label: 'Move axes',
      proName: 'Manipulator Space',
      section: 'transform',
      kind: 'enum',
      options: [
        { value: 'world', label: 'World' },
        { value: 'object', label: "The part's own" },
      ],
      writer: 'prefs.set',
      help: 'The axes the Move ring follows; the ring can switch them too.',
    },
  ],
  rotateSpace: [
    {
      path: 'rotateSpace',
      label: 'Turn axes',
      proName: 'Manipulator Space',
      section: 'transform',
      kind: 'enum',
      options: [
        { value: 'object', label: "The part's own" },
        { value: 'world', label: 'World' },
        { value: 'gimbal', label: 'One ring per turn channel (gimbal)' },
      ],
      writer: 'prefs.set',
      help: 'The axes the turn ring follows; the ring can switch them too.',
    },
  ],
  reduceOnImport: [
    {
      path: 'reduceOnImport',
      label: 'Simplify keys on import',
      proName: 'Reduce keys on import',
      section: 'import',
      kind: 'enum',
      options: [
        { value: 'auto', label: 'Only dense animations' },
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' },
      ],
      writer: 'prefs.set',
      help: 'Removes the keys an imported animation does not need, within a small error.',
    },
  ],
  uiScale: [
    {
      path: 'uiScale',
      label: 'Text & touch size',
      section: 'display',
      kind: 'number',
      unit: '%',
      display: 'fraction-as-percent',
      range: { min: 85, max: 150, step: 5 },
      writer: 'prefs.set',
      shared: true,
      help: 'Scales text and touch targets in both layouts; a size Studio Pro stored outside this range is clamped.',
    },
  ],
  autoRigIk: [
    {
      path: 'autoRigIk.legs',
      label: 'Feet lead on new characters',
      section: 'animation',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Characters you import start with the feet leading the legs (leg IK).',
    },
    {
      path: 'autoRigIk.arms',
      label: 'Hands lead on new characters',
      section: 'animation',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Characters you import start with the hands leading the arms (arm IK).',
    },
  ],
  ikFkVisibility: [
    {
      path: 'ikFkVisibility',
      label: 'Controls of the side that does not lead',
      section: 'animation',
      kind: 'enum',
      options: [
        { value: 'hide', label: 'Hidden' },
        { value: 'ghost', label: 'Faded' },
      ],
      hidden: "Only 'hide' exists: the faded display is not built and `prefs.set` refuses 'ghost' (M2A-SPEC §1.2).",
      writer: 'prefs.set',
    },
  ],
  ikFkSwitchKey: [
    {
      path: 'ikFkSwitchKey',
      label: 'Keys when the lead switches',
      proName: 'Switch keys',
      section: 'animation',
      kind: 'enum',
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'none', label: 'No keys' },
        { value: 'key', label: 'Key this frame' },
        { value: 'seamless', label: 'Key this and the previous frame' },
      ],
      writer: 'prefs.set',
      help: 'What switching Hand leads or Foot leads keys, so the pose does not jump.',
    },
  ],
  tweenOvershoot: [
    {
      path: 'tweenOvershoot',
      label: 'Blend can go past its keys',
      proName: 'Overshoot',
      section: 'animation',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Lets Blend reach 150 % instead of stopping at the neighbouring keys.',
    },
  ],
  arrowKeys: [
    {
      path: 'arrowKeys',
      label: 'Arrow keys',
      section: 'keyboard',
      kind: 'enum',
      options: [
        { value: 'pickWalk', label: 'Select the next part' },
        { value: 'frames', label: 'Step through frames' },
      ],
      writer: 'prefs.set',
      help: 'What the arrow keys do outside text fields.',
    },
  ],
  virtualSlider: [
    {
      path: 'virtualSlider.degPerPx',
      label: 'Drag speed for angles',
      section: 'input',
      kind: 'number',
      unit: 'deg/px',
      range: { min: 0.05, max: 5, step: 0.05 },
      writer: 'prefs.set',
      help: 'How many degrees a drag of one pixel on a number changes.',
    },
    {
      path: 'virtualSlider.metresPerPx',
      label: 'Drag speed for distances',
      section: 'input',
      kind: 'number',
      unit: 'm/px',
      range: { min: 0.001, max: 0.1, step: 0.001 },
      writer: 'prefs.set',
      help: 'How many metres a drag of one pixel on a number changes.',
    },
    {
      path: 'virtualSlider.unitsPerPx',
      label: 'Drag speed for other numbers',
      section: 'input',
      kind: 'number',
      unit: 'units/px',
      range: { min: 0.001, max: 0.1, step: 0.001 },
      writer: 'prefs.set',
      help: 'How much a drag of one pixel changes a number without a unit.',
    },
    {
      path: 'virtualSlider.viewportMmb',
      label: 'Middle-button drag in the view changes values',
      section: 'input',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'With channels selected in Numbers, a middle-button drag in the view changes their values.',
    },
  ],
  exportReduce: [
    {
      path: 'exportReduce.enabled',
      label: 'Simplify keys on export',
      proName: 'Reduce keys',
      section: 'export',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Each export starts with key simplification on; the export itself can still turn it off.',
    },
    {
      path: 'exportReduce.positionM',
      label: 'Allowed position error',
      section: 'export',
      kind: 'number',
      unit: 'mm',
      display: 'metres-as-millimetres',
      range: { min: 0.01, max: 10, step: 0.01 },
      writer: 'prefs.set',
      help: "For a 1.7 m character; the allowance follows the character's height.",
    },
    {
      path: 'exportReduce.rotationCapRad',
      label: 'Allowed turn error',
      section: 'export',
      kind: 'number',
      unit: '°',
      display: 'radians-as-degrees',
      range: { min: 0.01, max: 5, step: 0.01 },
      writer: 'prefs.set',
      help: 'The most any joint may turn away from the original.',
    },
    {
      path: 'exportReduce.minLeverM',
      label: 'Shortest bone counted',
      section: 'export',
      kind: 'number',
      unit: 'mm',
      display: 'metres-as-millimetres',
      range: { min: 1, max: 100, step: 1 },
      writer: 'prefs.set',
      help: 'Shorter bones are judged as if they were this long.',
    },
    {
      path: 'exportReduce.scaleRel',
      label: 'Allowed scale error',
      section: 'export',
      kind: 'number',
      unit: '%',
      display: 'fraction-as-percent',
      range: { min: 0.001, max: 1, step: 0.001 },
      writer: 'prefs.set',
      help: 'The most any scale may differ from the original, as a share of it.',
    },
  ],
  autosave: [
    {
      path: 'autosave.enabled',
      label: 'Autosave',
      section: 'autosave',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Keeps a recovery copy of the project in this browser while you work.',
    },
    {
      path: 'autosave.delayMs',
      label: 'Autosave after a pause of',
      section: 'autosave',
      kind: 'number',
      unit: 's',
      display: 'ms-as-seconds',
      range: { min: 0.5, max: 30, step: 0.5 },
      writer: 'prefs.set',
      help: 'How long after your last change the recovery copy is written.',
    },
    {
      path: 'autosave.maxIntervalMs',
      label: 'Autosave at least every',
      section: 'autosave',
      kind: 'number',
      unit: 's',
      display: 'ms-as-seconds',
      range: { min: 5, max: 600, step: 5 },
      writer: 'prefs.set',
      help: 'The longest time between recovery copies while you keep working.',
    },
  ],
  lastWorkspace: [
    {
      path: 'lastWorkspace',
      label: 'Studio Pro opens on',
      section: 'internal',
      kind: 'text',
      hidden: 'Bookkeeping: the workspace Studio Pro opens on, written whenever the workspace changes.',
      writer: 'workspace.set',
    },
  ],
  modeling: [
    {
      path: 'modeling.primitiveDefaults',
      label: 'Detail of new shapes',
      section: 'modeling',
      kind: 'enum',
      options: [
        { value: 'low-poly', label: 'Low (game-ready)' },
        { value: 'dcc', label: 'Like a desktop 3D app' },
      ],
      writer: 'prefs.set',
      help: 'The segment counts a New shape starts with.',
    },
    {
      path: 'modeling.numericCapture',
      label: 'Typing a number while you edit',
      section: 'keyboard',
      kind: 'enum',
      options: [
        { value: 'auto', label: 'Goes into the edit right away' },
        { value: 'explicit', label: 'Only after pressing T' },
      ],
      writer: 'prefs.set',
      help: 'In Make, whether digits typed during a drag or right after a shortcut set its numbers.',
    },
    {
      path: 'modeling.undoSelection.model',
      label: 'Undo selection changes in Make and Paint',
      section: 'undo',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Each selection change in Make and Paint is an undo step of its own.',
    },
    {
      path: 'modeling.undoSelection.animate',
      label: 'Undo selection changes in Animate',
      section: 'undo',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Each selection change in Animate is an undo step of its own.',
    },
    {
      path: 'modeling.undoSelection.rig',
      label: 'Undo selection changes in Rig',
      section: 'undo',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Each selection change in Rig is an undo step of its own.',
    },
    {
      path: 'modeling.undoBudgetMB',
      label: 'Memory for shape undo',
      section: 'undo',
      kind: 'number',
      unit: 'MB',
      range: { min: 32, max: 2048, step: 32 },
      writer: 'prefs.set',
      help: 'The most memory undo keeps for shape edits; on iPad the device profile lowers it for the page.',
    },
    {
      path: 'modeling.journalBudgetMB',
      label: 'Memory for fast shape undo',
      section: 'undo',
      kind: 'number',
      unit: 'MB',
      range: { min: 8, max: 1024, step: 8 },
      writer: 'prefs.set',
      help: 'The part of it kept for instant undo and redo of recent shape edits; iPad lowers it too.',
    },
    {
      path: 'modeling.symmetryTolerance',
      label: 'Mirror match distance',
      section: 'modeling',
      kind: 'number',
      unit: 'mm',
      display: 'metres-as-millimetres',
      range: { min: 0.01, max: 10, step: 0.01 },
      writer: 'prefs.set',
      help: "Points this close to each other's mirror position count as a pair.",
    },
    {
      path: 'modeling.gridStep',
      label: 'Grid snap step',
      section: 'modeling',
      kind: 'number',
      unit: 'm',
      range: { min: 0.001, max: 10, step: 0.001 },
      writer: 'prefs.set',
      help: 'The spacing that grid snapping uses.',
    },
    {
      path: 'modeling.increments.move',
      label: 'Snap step for Move',
      section: 'modeling',
      kind: 'number',
      unit: 'm',
      range: { min: 0.001, max: 10, step: 0.001 },
      writer: 'prefs.set',
      help: 'The step Move snaps to while step snapping is on.',
    },
    {
      path: 'modeling.increments.rotate',
      label: 'Snap step for Turn',
      section: 'modeling',
      kind: 'number',
      unit: '°',
      display: 'radians-as-degrees',
      range: { min: 0.5, max: 180, step: 0.5 },
      writer: 'prefs.set',
      help: 'The step a turn snaps to while step snapping is on.',
    },
    {
      path: 'modeling.increments.scale',
      label: 'Snap step for Scale',
      section: 'modeling',
      kind: 'number',
      unit: '×',
      range: { min: 0.01, max: 10, step: 0.01 },
      writer: 'prefs.set',
      help: 'The step Scale snaps to while step snapping is on.',
    },
    {
      path: 'modeling.vertexSnapRadiusPx',
      label: 'Point snap reach',
      section: 'modeling',
      kind: 'number',
      unit: 'px',
      range: { min: 1, max: 64, step: 1 },
      writer: 'prefs.set',
      help: 'How close to a point the pointer must be for point snapping.',
    },
    {
      path: 'modeling.multiCutSnapStep',
      label: 'Multi-Cut snap step',
      proName: 'Snap step',
      section: 'modeling',
      kind: 'number',
      unit: '%',
      display: 'fraction-as-percent',
      range: { min: 1, max: 100, step: 1 },
      writer: 'prefs.set',
      help: 'Multi-Cut snaps along an edge in steps of this share of its length.',
    },
    {
      path: 'modeling.optionDefaults',
      label: 'Default options of Make tools',
      section: 'modeling',
      kind: 'record',
      hidden: 'Per operator id; written only by Options › Make default (§16.4).',
      writer: 'prefs.set',
      shared: true,
    },
    {
      path: 'modeling.toolkitCollapsed',
      label: 'Collapsed toolkit sections',
      section: 'internal',
      kind: 'list',
      hidden: "Bookkeeping of Studio Pro's Modeling Toolkit, which writes the store directly.",
      writer: 'none',
    },
    {
      path: 'modeling.paletteRecents',
      label: 'Recent commands',
      section: 'internal',
      kind: 'list',
      hidden: "Bookkeeping of Studio Pro's command palette.",
      writer: 'prefs.set',
    },
    {
      path: 'modeling.convertOnModeSwitch',
      label: 'Convert the selection between points, edges and faces',
      section: 'modeling',
      kind: 'boolean',
      writer: 'prefs.set',
      help: 'Off keeps a separate selection for points, edges and faces.',
    },
  ],
  rigging: [
    {
      path: 'rigging.jointSize',
      label: 'Joint size',
      proName: 'Joint Size',
      section: 'rigging',
      kind: 'number',
      unit: '×',
      range: { min: 0.25, max: 4, step: 0.25 },
      writer: 'rig.jointSize.set',
      help: "How large joints are drawn, relative to the character's height.",
    },
    {
      path: 'rigging.brush.op',
      label: 'Weight brush mode',
      proName: 'Paint operation',
      section: 'rigging',
      kind: 'enum',
      options: [
        { value: 'replace', label: 'Set' },
        { value: 'add', label: 'Increase' },
        { value: 'scale', label: 'Multiply' },
        { value: 'smooth', label: 'Smooth' },
      ],
      writer: 'skin.paint.set',
      help: 'What a weight stroke does; the brush bar changes it while you paint.',
    },
    {
      path: 'rigging.brush.value',
      label: 'Weight brush value',
      proName: 'Value',
      section: 'rigging',
      kind: 'number',
      unit: '%',
      display: 'fraction-as-percent',
      range: { min: 0, max: 100, step: 1 },
      writer: 'skin.paint.set',
      help: 'The weight a stroke sets, adds or multiplies by.',
    },
    {
      path: 'rigging.brush.opacity',
      label: 'Weight brush strength',
      proName: 'Opacity',
      section: 'rigging',
      kind: 'number',
      unit: '%',
      display: 'fraction-as-percent',
      range: { min: 0, max: 100, step: 1 },
      writer: 'skin.paint.set',
      help: 'How much of the value one stroke applies.',
    },
    {
      path: 'rigging.brush.radiusPx',
      label: 'Weight brush size',
      proName: 'Radius',
      section: 'rigging',
      kind: 'number',
      unit: 'px',
      range: { min: 1, max: 1000, step: 1 },
      writer: 'skin.paint.set',
      help: 'The radius of the brush on screen.',
    },
    {
      path: 'rigging.brush.falloff',
      label: 'Weight brush edge',
      proName: 'Falloff',
      section: 'rigging',
      kind: 'enum',
      options: [
        { value: 'smooth', label: 'Soft' },
        { value: 'linear', label: 'Even' },
        { value: 'constant', label: 'Hard' },
      ],
      writer: 'skin.paint.set',
      help: 'How the stroke fades towards the edge of the brush.',
    },
    {
      path: 'rigging.brush.reach',
      label: 'Weight brush reach',
      proName: 'Reach',
      section: 'rigging',
      kind: 'enum',
      options: [
        { value: 'surface', label: 'Along the surface' },
        { value: 'volume', label: 'Through the volume' },
      ],
      writer: 'skin.paint.set',
      help: 'Whether the brush follows the surface or reaches every point inside its radius.',
    },
    {
      path: 'rigging.brush.frontOnly',
      label: 'Weight brush paints facing surfaces only',
      proName: 'Front faces only',
      section: 'rigging',
      kind: 'boolean',
      writer: 'skin.paint.set',
      help: 'Off also paints the surfaces facing away from you.',
    },
    {
      path: 'rigging.brush.mirror',
      label: 'Weight brush mirrors strokes',
      proName: 'Mirror stroke',
      section: 'rigging',
      kind: 'boolean',
      hidden: "Never remembered: each Skin entry takes it from the skeleton's symmetry (`skin.paint.set` drops it).",
      writer: 'none',
    },
    {
      path: 'rigging.influenceSort',
      label: 'Order of the weights list',
      proName: 'Sort influences',
      section: 'rigging',
      kind: 'enum',
      options: [
        { value: 'hierarchy', label: 'By hierarchy' },
        { value: 'alpha', label: 'Alphabetical' },
        { value: 'flat', label: 'Flat list' },
      ],
      hidden: `Studio Pro's Paint Weights list writes the store directly; no operator writes it and ${NO_RIGGING_KEY}.`,
      writer: 'none',
    },
    {
      path: 'rigging.influenceColours',
      label: 'Joint colours in the weight display',
      section: 'rigging',
      kind: 'record',
      hidden: 'Per joint name; nothing writes it yet.',
      writer: 'none',
    },
    {
      path: 'rigging.optionDefaults',
      label: 'Default options of Rig tools',
      section: 'rigging',
      kind: 'record',
      hidden: `Per operator id (and constraint type); Studio Pro's Rig Toolkit option boxes write the store directly and ${NO_RIGGING_KEY}.`,
      writer: 'none',
    },
    {
      path: 'rigging.orientPreset',
      label: 'Joint orientation of new chains',
      section: 'rigging',
      kind: 'enum',
      options: [
        { value: 'xAim', label: 'Along the bone (X)' },
        { value: 'yAim', label: 'Along the bone (Y)' },
        { value: 'world', label: 'World' },
      ],
      hidden: `Read by Orient Joint and the Joint tool for chains that are not humanoid; nothing writes it yet and ${NO_RIGGING_KEY}.`,
      writer: 'none',
    },
    {
      path: 'rigging.holds',
      label: 'Held joints',
      section: 'internal',
      kind: 'record',
      hidden:
        'Per project and character; written by Hold and Release in Skin (`skin.influence.hold`, `.holdAll`, `.releaseAll`).',
      writer: 'skin.influence.hold',
    },
  ],
};

/** Every descriptor, in `Prefs` order. */
export const PREF_DESCRIPTORS: readonly PrefDescriptor[] = Object.values(TABLE).flat();

const BY_PATH: ReadonlyMap<string, PrefDescriptor> = new Map(PREF_DESCRIPTORS.map((d) => [d.path, d]));

/** The descriptor of a dotted path (undefined: no such leaf, or a key inside a record). */
export function prefDescriptor(path: string): PrefDescriptor | undefined {
  return BY_PATH.get(path);
}

type Plain = Readonly<Record<string, unknown>>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every leaf path of a preferences value, `version` left out. A path with a descriptor is a leaf (so a record keyed
 * by user data stays whole); any other plain object recurses; arrays, scalars and empty objects are leaves. A stored
 * key the defaults do not have (`modeling.undoSelection.<workspace>`) is listed and has no descriptor.
 */
export function prefLeafPaths(prefs: Prefs): readonly string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (!isPlain(value) || BY_PATH.has(path) || Object.keys(value).length === 0) {
      out.push(path);
      return;
    }
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`);
  };
  for (const key of Object.keys(prefs)) {
    if (key !== 'version') walk((prefs as unknown as Plain)[key], key);
  }
  return out;
}

/** The value at a dotted path (undefined when the path does not exist). */
export function prefValue(prefs: Prefs, path: string): unknown {
  let value: unknown = prefs;
  for (const key of path.split('.')) {
    if (!isPlain(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

function setIn(value: unknown, keys: readonly string[], leaf: unknown): unknown {
  const [key, ...rest] = keys;
  if (key === undefined) return leaf;
  const base = isPlain(value) ? value : {};
  return { ...base, [key]: setIn(base[key], rest, leaf) };
}

/**
 * The `prefs.set` patch that writes `value` at `path`: the top-level key, replaced by a copy of `prefs`' value with
 * the leaf changed (`prefs.set` merges top-level keys only). Pass the store's state: under session overrides a write
 * that carries an overridden field's shown value back keeps that field's base value (`./overrides`).
 */
export function prefPatch(prefs: Prefs, path: string, value: unknown): Partial<Omit<Prefs, 'version'>> {
  const [top, ...rest] = path.split('.');
  if (top === undefined || top === 'version' || !Object.hasOwn(prefs, top)) {
    throw new EkzaError('invalid-input', `Unknown preference '${path}'`);
  }
  return { [top]: setIn((prefs as unknown as Plain)[top], rest, value) };
}

/** An operator call that writes one preference. */
export interface PrefWrite {
  readonly op: OperatorId;
  readonly args: Readonly<Record<string, unknown>>;
}

const BRUSH = 'rigging.brush.';

/**
 * The call a Settings control runs to write `value` at `path`: `prefs.set {patch}`, `rig.jointSize.set {size}` or
 * `skin.paint.set {patch: {<brush field>: value}}` (which also sets the current brush). Null when the descriptor's
 * writer is `'none'` or takes no value from Settings (`workspace.set`, `skin.influence.hold`), or for an unknown path.
 * Named writers are registered with the Rig & Skin chunk: check `app.operators` before offering the control.
 */
export function prefWrite(prefs: Prefs, path: string, value: unknown): PrefWrite | null {
  const descriptor = BY_PATH.get(path);
  if (descriptor === undefined) return null;
  switch (descriptor.writer) {
    case 'prefs.set':
      return { op: 'prefs.set', args: { patch: prefPatch(prefs, path, value) } };
    case 'rig.jointSize.set':
      return { op: 'rig.jointSize.set', args: { size: value } };
    case 'skin.paint.set':
      return path.startsWith(BRUSH)
        ? { op: 'skin.paint.set', args: { patch: { [path.slice(BRUSH.length)]: value } } }
        : null;
    case 'none':
      return null;
    default:
      return null;
  }
}

const DISPLAYS: Readonly<
  Record<PrefDisplay, { readonly shown: (stored: number) => number; readonly stored: (shown: number) => number }>
> = {
  'radians-as-degrees': { shown: (rad) => (rad * 180) / Math.PI, stored: (deg) => (deg * Math.PI) / 180 },
  'ms-as-seconds': { shown: (ms) => ms / 1000, stored: (s) => s * 1000 },
  'fraction-as-percent': { shown: (fraction) => fraction * 100, stored: (percent) => percent / 100 },
  'metres-as-millimetres': { shown: (m) => m * 1000, stored: (mm) => mm / 1000 },
};

/** A stored number in the descriptor's shown unit (rounded to 12 significant digits: π/12 shows as 15°). */
export function prefShownValue(descriptor: PrefDescriptor, stored: number): number {
  if (descriptor.display === undefined) return stored;
  return Number(DISPLAYS[descriptor.display].shown(stored).toPrecision(12));
}

/** A number in the descriptor's shown unit converted to the stored unit (no clamping to `range`). */
export function prefStoredValue(descriptor: PrefDescriptor, shown: number): number {
  if (descriptor.display === undefined) return shown;
  return DISPLAYS[descriptor.display].stored(shown);
}
