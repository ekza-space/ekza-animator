// Viewport colours and sizes. The values are the design tokens of research 09 §8.2 (packages/ui/tokens.json); the
// viewport may not import the ui package (ARCHITECTURE §3), so the subset it draws with lives here.

export const VIEWPORT_THEME = {
  viewportTop: '#3e4047',
  viewportBottom: '#26272b',
  gridMinor: '#3a3c44',
  gridMajor: '#4b4e58',
  rigLeft: '#4f8dff',
  rigRight: '#ff5f69',
  rigCenter: '#ffd84d',
  sel: '#ffffff',
  selLead: '#7dff8a',
  selHover: '#ffe58a',
  axisX: '#ff5f69',
  axisY: '#5fd36e',
  axisZ: '#4f8dff',
  axisView: '#c8ccd4',
  axisActive: '#ffd84d',
  danger: '#ef6b6b',
  joint: '#9aa0ab',
  marquee: '#e6e7ea',
} as const;

/** Control line widths in CSS px (MVP-SPEC §4.11.15): side colour 2, hover +1, selected and lead 3. */
export const CONTROL_WIDTH = { normal: 2, highlight: 3 } as const;

/** Opacity of control segments hidden behind geometry (pass A, `GreaterDepth`). */
export const OCCLUDED_ALPHA = 0.35;

/** Hover lightens the side colour by this fraction of the remaining lightness (HSL). */
export const HOVER_LIGHTEN = 0.2;

/** Picking tolerances in CSS px (MVP-SPEC §4.11.16). */
export const PICK = {
  controlPx: 6,
  jointPx: 6,
  manipulatorPx: 7,
  cycleRadiusPx: 3,
  marqueeMinPx: 4,
} as const;

/** Mesh opacity while a pane shows x-ray. */
export const XRAY_OPACITY = 0.5;
