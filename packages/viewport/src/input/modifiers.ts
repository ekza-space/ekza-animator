// Virtual modifiers (STUDIO-TOUCH-SPEC §5.5, §20.3 item 3, §20.4; T1): what a touch shell's Thumb key holds, as the
// tools read keyboard modifiers and held keys. `ViewportManager.setModifierSource` merges Shift / Mod / Alt and the
// stand-in button into every tool pointer event, hands the source the active tool's key path (the source sends a
// down for each held code that comes and an up for each that goes) and lends its holds to the rig runtime's held keys
// (`ViewportManager.modifierSource`). Each of them carries `virtual: true`. Tools keep their semantics; Studio Pro sets
// no source.
import type { Disposer } from '@ekza-studio/anim-core';
import type { ToolKeyEvent } from '@ekza-studio/editor-core';

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

/** What `ViewportManager.setModifierSource` takes (`createModifierSource` builds one). */
export interface ModifierSource {
  get(): VirtualModifiers;
  /**
   * The manager hands the active tool's key path: send a down (`virtual`) for every code held now and every code
   * that comes, an up for every code that goes, and an up for every code still held when the disposer runs.
   */
  attach(deliver: (e: ToolKeyEvent) => void): Disposer;
}

/** No virtual modifier on. */
export const NO_MODIFIERS: VirtualModifiers = { shift: false, mod: false, alt: false, held: new Set() };

/** A virtual hold's key event for a tool. */
export const virtualKey = (type: 'down' | 'up', code: string): ToolKeyEvent => ({
  type,
  code,
  shift: false,
  alt: false,
  mod: false,
  ctrl: false,
  repeat: false,
  virtual: true,
});

/** Ups for the codes of `from` not in `to`, then downs for the codes of `to` not in `from`. */
function sendHolds(deliver: (e: ToolKeyEvent) => void, from: ReadonlySet<string>, to: ReadonlySet<string>): void {
  for (const code of from) if (!to.has(code)) deliver(virtualKey('up', code));
  for (const code of to) if (!from.has(code)) deliver(virtualKey('down', code));
}

/**
 * The source a shell sets from its Thumb key: `set` replaces the modifiers, sends the held codes' changes and notifies
 * its subscribers. To hand a latched hold to a tool activated meanwhile, set the modifiers without it and then with
 * it again (the active tool gets the up and the down).
 */
export function createModifierSource(initial: VirtualModifiers = NO_MODIFIERS): ModifierSource & {
  set(next: VirtualModifiers): void;
  subscribe(onChange: () => void): Disposer;
} {
  let current = initial;
  const listeners = new Set<() => void>();
  const deliveries = new Set<(e: ToolKeyEvent) => void>();
  return {
    get: () => current,
    attach(deliver) {
      deliveries.add(deliver);
      sendHolds(deliver, NO_MODIFIERS.held, current.held);
      return () => {
        if (deliveries.delete(deliver)) sendHolds(deliver, current.held, NO_MODIFIERS.held);
      };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    set(next) {
      const before = current.held;
      current = next;
      for (const deliver of deliveries) sendHolds(deliver, before, next.held);
      for (const listener of listeners) listener();
    },
  };
}
