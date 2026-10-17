// Numeric codes of the compiled rig (kept in a module without imports so every layer can use them).

/** How a control drives its bone (MVP-SPEC §4.2 `Binding.mode`). */
export const BIND_NONE = 0;
export const BIND_ROTATE = 1;
export const BIND_TRANSLATE_ROTATE = 2;
export const BIND_FULL = 3;

/** Schedule entry kinds. */
export const OP_CONTROL = 0;
export const OP_BONE = 1;
export const OP_CUSTOM = 2;
