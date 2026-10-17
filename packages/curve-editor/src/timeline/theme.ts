// Time-slider colours: the ui design tokens (research 09 §8.2) read from CSS custom properties on the canvas, with
// the tokens.json values as fallbacks so the slider draws correctly before (or without) the token stylesheet.

export interface TimelineTheme {
  readonly background: string;
  readonly outside: string;
  readonly rulerMinor: string;
  readonly rulerMajor: string;
  readonly label: string;
  readonly keyTick: string;
  readonly keySelected: string;
  readonly band: string;
  readonly bandEdge: string;
  readonly playhead: string;
  readonly playheadText: string;
  readonly rangeMarker: string;
  readonly autoKey: string;
  readonly font: string;
}

/** tokens.json values, keyed by CSS custom property. */
const TOKENS: Readonly<Record<keyof TimelineTheme, readonly [string, string]>> = {
  background: ['--bg-field', '#17181b'],
  outside: ['--range-outside', 'rgba(0,0,0,0.28)'],
  rulerMinor: ['--grid-major', '#4b4e58'],
  rulerMajor: ['--text-3', '#969ba6'],
  label: ['--text-3', '#969ba6'],
  keyTick: ['--key-tick', '#e5484d'],
  keySelected: ['--sel', '#ffffff'],
  band: ['--range-select', 'rgba(229,72,77,0.22)'],
  bandEdge: ['--range-select-edge', '#e5484d'],
  playhead: ['--playhead', '#ff8a3d'],
  playheadText: ['--bg-app', '#1b1c1f'],
  rangeMarker: ['--text-2', '#aeb2bb'],
  autoKey: ['--autokey', '#e5484d'],
  font: ['--font-mono', 'ui-monospace, monospace'],
};

export const DEFAULT_TIMELINE_THEME: TimelineTheme = Object.fromEntries(
  Object.entries(TOKENS).map(([name, [, fallback]]) => [name, fallback]),
) as unknown as TimelineTheme;

/** Reads the tokens visible at `element` (its computed style); unset properties keep their defaults. */
export function readTimelineTheme(element: Element): TimelineTheme {
  const view = element.ownerDocument.defaultView;
  if (view === null) return DEFAULT_TIMELINE_THEME;
  const style = view.getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const [name, [property, fallback]] of Object.entries(TOKENS)) {
    const value = style.getPropertyValue(property).trim();
    theme[name] = value === '' ? fallback : value;
  }
  return theme as unknown as TimelineTheme;
}
