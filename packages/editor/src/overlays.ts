// `@ekza-studio/editor/overlays` (STUDIO-TOUCH-SPEC §20.1, §20.3 item 9; T5c): the overlay logic Halo shares with
// Studio Pro. The marking menu's geometry (compass slots, radius, the flick rule) for the Halo ring, and the command
// palette's controller and data (entries, fuzzy ranking, parameter prompts) for Halo's own touch palette view (§8: Pro's
// palette view is not restyled). Both modules are lazy chunks in Pro, so a Halo import costs `/editor` 0 B (measured,
// docs/wp-notes/halo-t5c.md). The geometry lives in the marking-menu controller module, so importing it brings the
// controller (≈ 2.3 kB gzip if eager in `/app`); the palette controller brings Pro's menu shortcuts (≈ 3.3 kB): Halo
// loads the palette lazily (§20.6).
export {
  COMPASS,
  EDGE_MARGIN,
  FLICK_MS,
  FLICK_PX,
  LIST_OFFSET,
  MM_RADIUS,
  menuLabel,
  slotPosition,
  slotToward,
} from './overlays/MarkingMenu/controller';
export {
  type CommandPaletteController,
  type CommandPaletteDeps,
  createCommandPaletteController,
  filterEntries,
  formatParam,
  fuzzyScore,
  type PaletteEntry,
  type PalettePrompt,
  type PaletteState,
  paletteEntries,
  parseParam,
} from './overlays/CommandPalette/controller';
