// Tokens → theme (M6A-SPEC §8.9): the fallbacks equal packages/ui/tokens.json, computed-style reads override them, and
// unparsable or unset values fall back.
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import {
  DEFAULT_MESH_VIEW_THEME,
  MESH_VIEW_SOFT_TOKENS,
  MESH_VIEW_TOKENS,
  parseHexColour,
  readMeshViewTheme,
} from '../src';

let element: HTMLElement | null = null;
afterEach(() => {
  element?.remove();
  element = null;
});

describe('mesh-view theme', () => {
  it('falls back to the tokens.json values of every §8.9 token it reads', async () => {
    const tokens: unknown = JSON.parse(await commands.readFile('../ui/tokens.json'));
    const flat = new Map<string, string>();
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (typeof inner === 'string' && inner.startsWith('#')) flat.set(key, inner.toLowerCase());
        else walk(inner);
      }
    };
    walk(tokens);
    const all = [...Object.values(MESH_VIEW_TOKENS), ...MESH_VIEW_SOFT_TOKENS];
    expect(all).toHaveLength(19);
    for (const [property, fallback] of all) {
      expect(flat.get(property.slice(2)), property).toBe(fallback);
    }
    expect(DEFAULT_MESH_VIEW_THEME.selected).toBe(0xffa31a);
    expect(DEFAULT_MESH_VIEW_THEME.clay).toBe(0x6e7179);
    expect(DEFAULT_MESH_VIEW_THEME.soft).toEqual([0xffd84d, 0xff8a3d, 0xd9363e, 0x4a1a1e]);
  });

  it('reads the custom properties visible at an element', () => {
    element = document.createElement('div');
    element.style.setProperty('--comp-selected', '#123456');
    element.style.setProperty('--soft-2', '#abc');
    element.style.setProperty('--clay', 'not a colour');
    document.body.append(element);
    const theme = readMeshViewTheme(element);
    expect(theme.selected).toBe(0x123456);
    expect(theme.soft[1]).toBe(0xaabbcc);
    expect(theme.clay).toBe(DEFAULT_MESH_VIEW_THEME.clay);
    expect(theme.vertex).toBe(DEFAULT_MESH_VIEW_THEME.vertex);
  });

  it('parses #rgb and #rrggbb only', () => {
    expect(parseHexColour('#ffa31a')).toBe(0xffa31a);
    expect(parseHexColour(' #FFF ')).toBe(0xffffff);
    expect(parseHexColour('rgb(1, 2, 3)')).toBeNull();
    expect(parseHexColour('#12345')).toBeNull();
  });
});
