// Dope Sheet colours: the ui design tokens (research 09 §8.2: `--key-default`, `--key-selected`, `--key-breakdown`,
// `--playhead`, …) read from CSS custom properties on the canvas, with the tokens.json values as fallbacks.

export interface DopeSheetTheme {
  readonly background: string;
  readonly rowAlt: string;
  readonly summaryRow: string;
  readonly ruler: string;
  readonly rulerTick: string;
  readonly label: string;
  readonly line: string;
  readonly outside: string;
  readonly key: string;
  readonly keySelected: string;
  readonly keyBreakdown: string;
  readonly hold: string;
  readonly hatch: string;
  readonly playhead: string;
  readonly region: string;
  readonly regionEdge: string;
  readonly marqueeFill: string;
  readonly marqueeStroke: string;
  readonly font: string;
}

const TOKENS: Readonly<Record<keyof DopeSheetTheme, readonly [string | null, string]>> = {
  background: ['--bg-field', '#17181b'],
  rowAlt: [null, 'rgba(255,255,255,0.025)'],
  summaryRow: [null, 'rgba(255,255,255,0.06)'],
  ruler: ['--bg-header', '#2a2b30'],
  rulerTick: ['--grid-major', '#4b4e58'],
  label: ['--text-3', '#969ba6'],
  line: ['--border', '#3a3c44'],
  outside: ['--range-outside', 'rgba(0,0,0,0.28)'],
  key: ['--key-default', '#c8ccd4'],
  keySelected: ['--key-selected', '#ffd84d'],
  keyBreakdown: ['--key-breakdown', '#3fcf8e'],
  hold: ['--text-3', '#969ba6'],
  hatch: [null, 'rgba(200,204,212,0.35)'],
  playhead: ['--playhead', '#ff8a3d'],
  region: [null, 'rgba(255,216,77,0.18)'],
  regionEdge: ['--key-selected', '#ffd84d'],
  marqueeFill: [null, 'rgba(255,255,255,0.08)'],
  marqueeStroke: [null, 'rgba(255,255,255,0.7)'],
  font: ['--font-mono', 'ui-monospace, monospace'],
};

export const DEFAULT_DOPE_THEME: DopeSheetTheme = Object.fromEntries(
  Object.entries(TOKENS).map(([name, [, fallback]]) => [name, fallback]),
) as unknown as DopeSheetTheme;

/** Reads the tokens visible at `element` (its computed style); unset properties keep their defaults. */
export function readDopeSheetTheme(element: Element): DopeSheetTheme {
  const view = element.ownerDocument.defaultView;
  if (view === null) return DEFAULT_DOPE_THEME;
  const style = view.getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const [name, [property, fallback]] of Object.entries(TOKENS)) {
    const value = property === null ? '' : style.getPropertyValue(property).trim();
    theme[name] = value === '' ? fallback : value;
  }
  return theme as unknown as DopeSheetTheme;
}
