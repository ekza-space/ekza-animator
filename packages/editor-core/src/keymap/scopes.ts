// Hierarchical key scopes (M6A-SPEC §5.17): a workspace with a key scope ('model') puts its own levels in front of
// the shipped panel scopes, so a deeper scope shadows a shallower one and `KeymapManager.resolve` stays a first match
// in chain order. Animate has no key scope: its chain is the shipped `<panel>` → `global`.
import {
  type Chord,
  type ComponentMode,
  GLOBAL_SCOPE,
  type KeyBinding,
  type KeyInput,
  type KeymapManager,
  type KeyScope,
  type KeyTrigger,
} from '../types';

/** The Model scopes of the §7 table (`m`, `mv`, `mvc`, `mvv`/`mve`/`mvf`, `mo`). */
export const MODEL_SCOPE = {
  model: 'model',
  viewport: 'model.viewport',
  component: 'model.viewport.component',
  vertex: 'model.viewport.vertex',
  edge: 'model.viewport.edge',
  face: 'model.viewport.face',
  outliner: 'model.outliner',
} as const;

/** Keys a viewport tool that is placing or dragging receives before the keymap (§5.10, §5.17, §7). */
export const RESERVED_MODAL_KEYS: ReadonlySet<string> = new Set([
  'Backspace',
  'Enter',
  'NumpadEnter',
  'PageUp',
  'PageDown',
  'Escape',
]);

export interface ScopeChainInput {
  /** The active workspace's `keyScope` (null: Animate, the shipped chain). */
  readonly workspace: KeyScope | null;
  /** The key scope of the panel under the pointer (null or 'global': no panel). */
  readonly panel: KeyScope | null;
  /** The pointer is over the viewport panel (component scopes apply there only). */
  readonly viewport: boolean;
  readonly mode: ComponentMode;
  /**
   * M6b (CR-4): the active workspace's mode scope suffixes, deepest first (`WorkspaceDef.keyModes`); when given they
   * replace Model's component-mode levels over the viewport (`rig.viewport.skeleton` → `rig.viewport`). Absent or
   * null: Model's rule (`<w>.viewport.<mode>` → `<w>.viewport.component` in a component mode).
   */
  readonly modes?: readonly string[] | null;
}

/**
 * Most specific first, ending with 'global'. In a workspace with a key scope `w`, over the viewport in a component
 * mode: `w.viewport.<mode>` → `w.viewport.component` → `w.viewport` → `viewport` → `w` → `global` (with `modes`, M6b
 * CR-4: `w.viewport.<modes[0]>` → … → `w.viewport` → …); over another panel
 * `w.<panel>` → `<panel>` → `w` → `global`; outside every panel `w` → `global`.
 */
export function keyScopeChain(input: ScopeChainInput): KeyScope[] {
  const { workspace, mode } = input;
  const panel = input.panel === GLOBAL_SCOPE ? null : input.panel;
  if (workspace === null) return panel === null ? [GLOBAL_SCOPE] : [panel, GLOBAL_SCOPE];
  if (panel === null) return [workspace, GLOBAL_SCOPE];
  const own = `${workspace}.${panel}`;
  const suffixes = input.modes ?? (mode !== 'object' ? [mode, 'component'] : []);
  const component = input.viewport ? suffixes.map((suffix) => `${own}.${suffix}`) : [];
  return [...component, own, panel, workspace, GLOBAL_SCOPE];
}

/** The key input a chord produces on `platform` (`mod` = Cmd on macOS, Ctrl elsewhere). */
export function chordInput(chord: Chord, platform: 'mac' | 'other'): KeyInput {
  const mod = chord.mod === true;
  return {
    code: chord.code,
    ctrlKey: chord.ctrl === true || (platform === 'other' && mod),
    metaKey: platform === 'mac' && mod,
    shiftKey: chord.shift === true,
    altKey: chord.alt === true,
    repeat: false,
  };
}

/** The binding a chord resolves to over `scopes` (what pressing it would run there). */
export function resolveChord(
  keymap: KeymapManager,
  chord: Chord,
  scopes: readonly KeyScope[],
  trigger: KeyTrigger = 'press',
): KeyBinding | null {
  return keymap.resolve(chordInput(chord, keymap.platform), scopes, trigger);
}
