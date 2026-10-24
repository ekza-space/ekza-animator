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
  /** M2a: breakdown keys (◇, §5.12). */
  readonly keyBreakdown: string;
  /** M2a: buffer curves (dashed, §5.15.1). */
  readonly curveBuffer: string;
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
  keyBreakdown: '#3fcf8e',
  curveBuffer: '#7d828d',
  tangent: '#9aa0ab',
  tangentSelected: '#ff9f43',
  tangentBroken: '#3fd1d9',
  playhead: '#ff8a3d',
  hover: '#ffe58a',
  marqueeFill: 'rgba(255,255,255,0.08)',
  marqueeStroke: 'rgba(255,255,255,0.7)',
  font: '10px "JetBrains Mono Variable", ui-monospace, monospace',
};

/**
 * Tolerances of the curve editors by pointer type (STUDIO-TOUCH-SPEC §5.4, ST-8; T1), CSS px: the Graph Editor's hit
 * radii (key, tangent handle, curve), the Dope Sheet's key glyph and region handles, the drag slop and the Shift axis
 * lock's travel. The mouse's are today's (MVP-SPEC §4.11.18, research 09 §6.2); a finger's and the pen's follow the
 * pick radius (22 / 9) and slop (10 / 4) of §5.4.
 */
export const CURVE_POINTER_TOLERANCE = {
  mouse: { hitKey: 6, hitHandle: 5, hitCurve: 4, glyphPx: 6, regionHandlePx: 6, dragPx: 3, axisLockPx: 4 },
  pen: { hitKey: 9, hitHandle: 9, hitCurve: 9, glyphPx: 9, regionHandlePx: 9, dragPx: 4, axisLockPx: 4 },
  touch: { hitKey: 22, hitHandle: 22, hitCurve: 22, glyphPx: 22, regionHandlePx: 22, dragPx: 10, axisLockPx: 10 },
} as const;

type CurveTolerance = { -readonly [K in keyof (typeof CURVE_POINTER_TOLERANCE)['mouse']]: number };

/**
 * The curve editors' tolerances of the pointer in use: the mouse's until a controller sees a pen or a finger
 * (`setCurvePointer`, called by the Graph Editor's and the Dope Sheet's controllers on every press and move).
 */
export const CURVE_TOLERANCE: CurveTolerance = { ...CURVE_POINTER_TOLERANCE.mouse };

/** Sizes in CSS px (research 09 §4.7). The hit tolerances are the pointer in use's (`setCurvePointer`). */
export const GRAPH_METRICS: {
  readonly key: number;
  readonly keySelected: number;
  readonly handleRadius: number;
  readonly handleLength: number;
  readonly curveWidth: number;
  readonly selectedSegmentWidth: number;
  readonly inactiveAlpha: number;
  hitKey: number;
  hitHandle: number;
  hitCurve: number;
} = {
  key: 5,
  keySelected: 7,
  handleRadius: 2,
  /** Screen length of non-weighted handles (MVP-SPEC §4.11.4). */
  handleLength: 40,
  curveWidth: 1.5,
  selectedSegmentWidth: 2,
  inactiveAlpha: 0.4,
  /** Hit tolerances (MVP-SPEC §4.11.18): the mouse's until `setCurvePointer` switches them. */
  hitKey: 6,
  hitHandle: 5,
  hitCurve: 4,
};

/** Switches the curve editors' tolerances to a pointer type's (§5.4; any other type is the mouse). */
export function setCurvePointer(pointerType: string): void {
  const row = CURVE_POINTER_TOLERANCE[pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse'];
  Object.assign(CURVE_TOLERANCE, row);
  GRAPH_METRICS.hitKey = row.hitKey;
  GRAPH_METRICS.hitHandle = row.hitHandle;
  GRAPH_METRICS.hitCurve = row.hitCurve;
}

const TOKENS: readonly (readonly [keyof GraphTheme, string])[] = [
  ['background', '--bg-field'],
  ['rangeOutside', '--range-outside'],
  ['gridMinor', '--grid-minor'],
  ['gridMajor', '--grid-major'],
  ['label', '--text-3'],
  ['key', '--key-default'],
  ['keySelected', '--key-selected'],
  ['keyBreakdown', '--key-breakdown'],
  ['curveBuffer', '--curve-buffer'],
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
