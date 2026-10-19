// Mesh overlay colours from the design tokens (M6A-SPEC §8.9): the CSS custom properties of `packages/ui/tokens.json`,
// read from the computed style of an element (the viewport canvas), with the tokens.json values as fallbacks so the
// overlays draw correctly before (or without) the token stylesheet. mesh-view may not import the ui package
// (ARCHITECTURE §3), so the fallback subset lives here; a test compares it with tokens.json.
import type { MeshViewTheme } from './types';

/**
 * §4.4 `MeshViewTheme` plus the `--clay` surface colour of the `shaded` mode (§4.7). `clay` is optional so every
 * contract theme stays valid; it falls back to the token value (M6A-B6-2).
 */
export type MeshViewThemeInput = MeshViewTheme & { readonly clay?: number };

type ScalarKey = Exclude<keyof MeshViewTheme, 'soft'>;

/** Theme field → [CSS custom property, tokens.json value]. */
export const MESH_VIEW_TOKENS: Readonly<Record<ScalarKey | 'clay', readonly [string, string]>> = {
  halo: ['--comp-halo', '#14151a'],
  vertex: ['--comp-vertex', '#d17bff'],
  selected: ['--comp-selected', '#ffa31a'],
  hover: ['--comp-hover', '#ffe58a'],
  wire: ['--wire', '#14151a'],
  wireMode: ['--wire-wiremode', '#c8ccd4'],
  hardEdge: ['--hard-edge', '#14151a'],
  normalFace: ['--normal-face', '#3fd1d9'],
  normalVertex: ['--normal-vertex', '#b18cff'],
  faceFront: ['--face-front', '#56b4e9'],
  faceBack: ['--face-back', '#e69f00'],
  symPlane: ['--sym-plane', '#5cc8ff'],
  lintNgon: ['--lint-ngon', '#e3b34a'],
  lintError: ['--lint-error', '#ef6b6b'],
  clay: ['--clay', '#6e7179'],
};

/** The soft-selection ramp, full weight first (`--soft-1` … `--soft-4`). */
export const MESH_VIEW_SOFT_TOKENS: readonly (readonly [string, string])[] = [
  ['--soft-1', '#ffd84d'],
  ['--soft-2', '#ff8a3d'],
  ['--soft-3', '#d9363e'],
  ['--soft-4', '#4a1a1e'],
];

/** `#rgb` / `#rrggbb` → 0xRRGGBB; null for anything else. */
export function parseHexColour(text: string): number | null {
  const value = text.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short !== null) {
    const [, r, g, b] = short as unknown as [string, string, string, string];
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  const long = /^#([0-9a-f]{6})$/i.exec(value);
  return long === null ? null : Number.parseInt(long[1] as string, 16);
}

function themeFrom(read: (property: string, fallback: string) => string): Required<MeshViewThemeInput> {
  const colour = (property: string, fallback: string): number =>
    parseHexColour(read(property, fallback)) ?? (parseHexColour(fallback) as number);
  const theme: Record<string, unknown> = {};
  for (const [key, [property, fallback]] of Object.entries(MESH_VIEW_TOKENS)) {
    theme[key] = colour(property, fallback);
  }
  theme['soft'] = MESH_VIEW_SOFT_TOKENS.map(([property, fallback]) => colour(property, fallback));
  return theme as unknown as Required<MeshViewThemeInput>;
}

/** The tokens.json values. */
export const DEFAULT_MESH_VIEW_THEME: Required<MeshViewThemeInput> = Object.freeze(
  themeFrom((_property, fallback) => fallback),
);

/**
 * Reads the tokens visible at `element` (its computed style); unset or unparsable properties keep the tokens.json
 * values. Values are `#rrggbb` (or `#rgb`) as the token stylesheet writes them.
 */
export function readMeshViewTheme(element: Element): Required<MeshViewThemeInput> {
  const view = element.ownerDocument.defaultView;
  if (view === null) return DEFAULT_MESH_VIEW_THEME;
  const style = view.getComputedStyle(element);
  return themeFrom((property, fallback) => {
    const value = style.getPropertyValue(property).trim();
    return value === '' ? fallback : value;
  });
}
