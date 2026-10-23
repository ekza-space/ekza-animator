// Key bindings of the rig step (AUTORIG-SPEC §8.1; D4 owns the list): none in the frame's table. `Space` plays /
// pauses the motion test in review, but only while the focus is on no control — a row here would make the frame's
// listener prevent `Space` everywhere in ③ and a focused button could no longer be pressed with it — so ③'s own
// listener (`steps/rig/keys.ts`) handles it (and prevents it: in Auto-Rig `Space` never maximizes panes). Adjust joints
// keeps the M6b joint tools' keys (`W`, `D`+`W`, `E`) and Paint weights the brush keys (`B` drag, `Ctrl`-click): they
// are Studio's viewport keymap rows, which the wizard does not shadow.
import type { AutoRigKeyBinding } from '../index';

export const rigKeys: readonly AutoRigKeyBinding[] = [];
