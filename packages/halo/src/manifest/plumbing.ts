// The plumbing allow-list (STUDIO-TOUCH-SPEC §20.5 test 1, ST-29; T6b): the few *internal* operators that need no
// surface of their own, each with its reason. Internal operators that Pro's panels reach are not plumbing: they need
// real Halo surfaces (§20.5 test 1's list). A new row needs a reason a reviewer accepts; public operators never use it.
export const PLUMBING_ALLOWLIST: Readonly<Record<string, string>> = {
  'model.animateOnly':
    "The poll-failing stand-in Studio Pro's Model keymap runs for Animate-only keys; Halo shows no such key (§5.8)",
  'rig.animateOnly':
    "The poll-failing stand-in Studio Pro's Rig & Skin keymap runs for Animate-only keys; Halo shows no such key",
  'ui.close': "Closes the host dialog that `ui.open` showed; Halo's sheets and cards close themselves (§6.7)",
  'ui.markingMenu':
    "Opens a marking menu by id from a key binding; Halo's ring opens from a long-press on the thing (§6.1)",
  'halo.proOnlyKey': "Halo's own poll-failing stand-in for the chords that arrange Pro's window (§5.8, T6a)",
  'shell.halo': "Studio Pro's switch into this layout (status line, Help and File menus); Halo is already here",
  'shell.autoRig':
    "Studio Pro's switch to Auto-Rig; Halo reaches Auto-Rig through `shell.navigate` (Home › Rig a model for me)",
  'view.cameraRadial':
    "Studio Pro's Space-hold camera radial; Halo's View puck and the View sheet's cameras replace it (§15 row 1.3)",
};
