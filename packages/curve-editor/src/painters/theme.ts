// Colours and sizes of the curve views (research 09 §4.7 keys/handles table, §8.2 tokens). Colours come from the
// design-token CSS variables when the host page defines them, with the token values as defaults.

export interface GraphTheme {
  readonly background: string;
  readonly rangeOutside: string;
  readonly gridMinor: string;
  readonly gridMajor: string;
  readonly label: string;
  readonly key: string;
  readonly keySelected: string;
  readonly tangent: string;
  readonly tangentSelected: string;
  readonly tangentBroken: string;
  readonly playhead: string;
  readonly hover: string;
  readonly marqueeFill: string;
  readonly marqueeStroke: string;
  readonly font: string;
}

export const DEFAULT_GRAPH_THEME: GraphTheme = {
  background: '#17181b',
  rangeOutside: 'rgba(0,0,0,0.28)',
  gridMinor: '#3a3c44',
  gridMajor: '#4b4e58',
  label: '#969ba6',
  key: '#c8ccd4',
  keySelected: '#ffd84d',
  tangent: '#9aa0ab',
  tangentSelected: '#ff9f43',
  tangentBroken: '#3fd1d9',
  playhead: '#ff8a3d',
  hover: '#ffe58a',
  marqueeFill: 'rgba(255,255,255,0.08)',
  marqueeStroke: 'rgba(255,255,255,0.7)',
  font: '10px "JetBrains Mono Variable", ui-monospace, monospace',
};

/** Sizes in CSS px (research 09 §4.7). */
export const GRAPH_METRICS = {
  key: 5,
  keySelected: 7,
  handleRadius: 2,
  /** Screen length of non-weighted handles (MVP-SPEC §4.11.4). */
  handleLength: 40,
  curveWidth: 1.5,
  selectedSegmentWidth: 2,
  inactiveAlpha: 0.4,
  /** Hit tolerances (MVP-SPEC §4.11.18). */
  hitKey: 6,
  hitHandle: 5,
  hitCurve: 4,
} as const;

const TOKENS: readonly (readonly [keyof GraphTheme, string])[] = [
  ['background', '--bg-field'],
  ['rangeOutside', '--range-outside'],
  ['gridMinor', '--grid-minor'],
  ['gridMajor', '--grid-major'],
  ['label', '--text-3'],
  ['key', '--key-default'],
  ['keySelected', '--key-selected'],
  ['tangent', '--tangent'],
  ['tangentSelected', '--tangent-selected'],
  ['tangentBroken', '--tangent-broken'],
  ['playhead', '--playhead'],
  ['hover', '--sel-hover'],
];

/** The theme with every token CSS variable the element inherits; missing variables keep the defaults. */
export function readGraphTheme(element: Element | null): GraphTheme {
  if (element === null || typeof getComputedStyle !== 'function') return DEFAULT_GRAPH_THEME;
  const style = getComputedStyle(element);
  const theme: Record<string, string> = { ...DEFAULT_GRAPH_THEME };
  for (const [field, variable] of TOKENS) {
    const value = style.getPropertyValue(variable).trim();
    if (value !== '') theme[field] = value;
  }
  return theme as unknown as GraphTheme;
}
