// AUTORIG-SPEC §4.5 (D4): the progress sheet's key guard — while the sheet is open every key is swallowed (no
// `Alt+1…5`, `Mod+Enter`, undo, step keys, Delete …) except the sheet's own keyboard (`Tab`, `Enter` / `Space` on its
// buttons) and a key aimed at another open dialog; without a sheet every key passes.
import { describe, expect, it } from 'vitest';
import { exclusiveRoute, type GuardElement, type GuardKey } from '../../../src/steps/rig/exclusive';

/** A tiny element tree: `contains` and `closest` over parent links (the selector is "a dialog"). */
class Node implements GuardElement {
  constructor(
    readonly tagName: string,
    readonly parent: Node | null = null,
    readonly dialog = false,
  ) {}
  contains(other: unknown): boolean {
    for (let at = other as Node | null; at !== null; at = at.parent) if (at === this) return true;
    return false;
  }
  closest(): GuardElement | null {
    if (this.dialog) return this;
    return this.parent === null ? null : this.parent.closest();
  }
}

const body = new Node('BODY');
const sheet = new Node('DIALOG', body, true);
const cancel = new Node('BUTTON', sheet);
const title = new Node('H2', sheet);
const confirm = new Node('DIV', body, true);
const confirmOk = new Node('BUTTON', confirm);
const pane = new Node('CANVAS', body);

const key = (code: string, target: unknown, mods: Partial<Pick<GuardKey, 'altKey' | 'ctrlKey' | 'metaKey'>> = {}) => ({
  code,
  target,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('the progress sheet key guard (§4.5)', () => {
  it('passes every key without an open sheet', () => {
    expect(exclusiveRoute(key('Digit1', cancel, { altKey: true }), null)).toBe('pass');
    expect(exclusiveRoute(key('KeyZ', pane, { metaKey: true }), null)).toBe('pass');
  });

  it('swallows the step, primary, undo and tool keys while the sheet is open, wherever the focus is', () => {
    for (const target of [cancel, title, sheet, pane, body, null]) {
      expect(exclusiveRoute(key('Digit1', target, { altKey: true }), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('Digit4', target, { altKey: true }), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('Enter', target, { metaKey: true }), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('KeyZ', target, { ctrlKey: true }), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('Delete', target), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('Backspace', target), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('KeyW', target), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('ArrowUp', target), sheet)).toBe('swallow');
      expect(exclusiveRoute(key('Escape', target), sheet)).toBe('swallow');
    }
    // Enter / Space activate only a button of the sheet
    expect(exclusiveRoute(key('Enter', title), sheet)).toBe('swallow');
    expect(exclusiveRoute(key('Space', pane), sheet)).toBe('swallow');
  });

  it("keeps the sheet's own keyboard: Tab, and Enter / Space on Cancel, reach nobody else but keep their default", () => {
    expect(exclusiveRoute(key('Tab', cancel), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('Tab', body), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('Enter', cancel), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('NumpadEnter', cancel), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('Space', cancel), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('ShiftLeft', cancel), sheet)).toBe('isolate');
    expect(exclusiveRoute(key('Tab', cancel, { altKey: true }), sheet)).toBe('swallow');
    expect(exclusiveRoute(key('Space', cancel, { ctrlKey: true }), sheet)).toBe('swallow');
  });

  it("leaves a key aimed at another open dialog (the host's confirm) to that dialog", () => {
    expect(exclusiveRoute(key('Enter', confirmOk), sheet)).toBe('pass');
    expect(exclusiveRoute(key('Escape', confirm), sheet)).toBe('pass');
  });
});
