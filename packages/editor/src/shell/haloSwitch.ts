// STUDIO-TOUCH-SPEC §16.1, §1.2 (T3): the lazy half of Pro's switch to Ekza Studio's Simple layout (`shell.halo`,
// `./menuItems`), built like Auto-Rig's (`./autoRigSwitch`): a small chunk of its own, prefetched when a menu showing
// the item opens, so `/editor`'s eager scripts keep only the operator, the two menu items and the status-line button
// (ST-B1). It never loads Halo's code: the switch is a same-page navigation through the host's port.
//
// What travels: the workspace (Halo arrives at the matching stage — Model → Make, Rig & Skin → Rig, Animate →
// Animate; Halo's arrival refines it from the same session: Paint when the Paint Colour tool is active, the Thread at
// Curves when keys are selected, a selected joint's Halo). The document, its undo history, the selection, the time and
// the cameras stay, as on every same-page switch.
import type { EditorApp, NavigationRequest } from '@ekza-studio/editor-core';
import { HALO_ENTRY, readEntryChoice, writeEntryChoice } from '../dialogs/entryChoice';

/** The request of Pro's switch. */
export function haloRequest(app: EditorApp): NavigationRequest {
  return { to: 'halo', from: 'studio', workspace: app.session.getState().workspace };
}

/**
 * §1.2: using the layout switch updates the remembered entry — a remembered Pro (`'studio'`) becomes Ekza Studio
 * (`'halo'`); Ask and Auto-Rig stay as they are. Behind `HALO_ENTRY` (T12): until then a stored `'halo'` reads as Ask,
 * so the switch writes nothing.
 */
export function rememberSimpleLayout(): void {
  if (HALO_ENTRY && readEntryChoice() === 'studio') writeEntryChoice('halo');
}
