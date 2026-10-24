// Deliberate Studio Pro hand-offs (STUDIO-TOUCH-SPEC §15.15, §20.5 test 6, ST-15; T6b). Only these reasons exist:
// - PRO_CHROME: the operators that configure Pro's docking window rather than the document — dock panels, layout
//   presets, the chrome toggles and focus mode (§15.15 a), the panel arguments of `view.toggleMaximize`, and the
//   Pro-only arguments of `ui.open` and `workspace.showPanel`;
// - MULTI_EDITOR: many editors visible at once (§15.15 b) — a presentation, never the only path;
// - KEYMAP: keymap customisation, once it exists (§15.15 c).
// Their operators stay runnable from search, marked "Opens in the Pro layout ▸". An entry with `proOnly` for an
// operator outside this set fails the parity check: a new hand-off needs a written reason here first.
export const PRO_CHROME_OPERATORS: ReadonlySet<string> = new Set([
  'workspace.preset.apply',
  'workspace.preset.save',
  'workspace.preset.rename',
  'workspace.preset.delete',
  'workspace.reset',
  'workspace.toggleChrome',
  'workspace.toggleFocus',
  'workspace.toggleTimeline',
  'workspace.showPanel',
  'view.toggleMaximize',
  'ui.open',
]);

export const PRO_REASONS = {
  dock: "Arranges Studio Pro's docked panels; Ekza Studio has its own fixed layout, sheets and Hide UI (§15.15 a)",
  presets: "Studio Pro's layout presets arrange its panels (§15.15 a)",
  chrome: "Shows or hides a part of Studio Pro's window chrome (Tool Strip, Help Line, Time Slider) (§15.15 a)",
  focus: "Studio Pro's focus mode; Ekza Studio's Hide UI is in the View sheet and the project menu (§15.15 a)",
  panel: "Maximizes one of Studio Pro's docked panels; a sheet in Ekza Studio has a full height instead (§15.15 a)",
  showPanel:
    'Shows a Studio Pro panel that has no Ekza Studio sheet of its own; its capabilities are on nouns (§15.15)',
} as const;
