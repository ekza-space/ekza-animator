// Virtual modifiers (STUDIO-TOUCH-SPEC §5.5, §20.3 item 3, §20.4; T1): what a touch shell's Thumb key holds, as the
// tools read keyboard modifiers and held keys. `ViewportManager.setModifierSource` merges Shift / Mod / Alt and the
// stand-in button into every tool pointer event, hands a held code that comes or goes to the active tool's `key()` as
// a down or up, and answers `virtualHeld` (the rig runtime's held keys). Each of them carries `virtual: true`. Tools
// keep their semantics; Studio Pro sets no source.
import type { Disposer } from '@ekza-studio/anim-core';

/** The codes a virtual hold may carry (the tool holds documented in `editor-core` `HOLD_CODES`). */
export type VirtualHoldCode = 'KeyX' | 'KeyV' | 'KeyJ' | 'KeyD' | 'KeyB' | 'KeyM' | 'KeyN' | 'KeyI';

export interface VirtualModifiers {
  readonly shift: boolean;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly held: ReadonlySet<VirtualHoldCode>;
  /** A primary press reaches the tools as this button (1 stands in for the middle button). */
  readonly button?: 0 | 1 | 2;
}

export interface ModifierSource {
  get(): VirtualModifiers;
  subscribe(onChange: () => void): Disposer;
}

/** No virtual modifier on. */
export const NO_MODIFIERS: VirtualModifiers = { shift: false, mod: false, alt: false, held: new Set() };

/**
 * A small source a shell sets from its Thumb key: `set` replaces the modifiers and notifies. To hand a latched hold
 * to a tool activated meanwhile, set the modifiers without it and then with it again (the manager sends the up and
 * the down to the active tool).
 */
export function createModifierSource(initial: VirtualModifiers = NO_MODIFIERS): ModifierSource & {
  set(next: VirtualModifiers): void;
} {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    set(next) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}
