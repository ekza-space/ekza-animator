// The manipulator's size by pointer type (STUDIO-TOUCH-SPEC §5.4, ST-8, ST-T1-5): bigger handles for a finger, at
// render time (`ViewportManager.setManipulatorScale`), never through `tools.manipulatorSize`, the session value Studio
// Pro shares. With hysteresis: the size switches only after two presses in a row of the other kind, so a stray mouse
// click on a touch screen (or a tap on a laptop's touch screen) does not make the handles jump.

/** Handle scale per pointer kind: a fingertip needs about 1.4× Pro's 90 px manipulator; the Pencil and the mouse 1×. */
export const MANIP_SCALE = { touch: 1.4, pen: 1, mouse: 1 } as const;

type Kind = keyof typeof MANIP_SCALE;
const kindOf = (pointerType: string): Kind =>
  pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse';

export interface ManipScale {
  /** A press of this pointer type; returns the scale in force after it. */
  press(pointerType: string): number;
  readonly scale: number;
}

export function createManipScale(initial: string = 'mouse'): ManipScale {
  let current: Kind = kindOf(initial);
  let pending: { kind: Kind; count: number } | null = null;
  return {
    press(pointerType) {
      const kind = kindOf(pointerType);
      if (MANIP_SCALE[kind] === MANIP_SCALE[current]) {
        pending = null;
        current = kind;
      } else if (pending !== null && pending.kind === kind) {
        pending.count += 1;
        if (pending.count >= 2) {
          current = kind;
          pending = null;
        }
      } else {
        pending = { kind, count: 1 };
      }
      return MANIP_SCALE[current];
    },
    get scale() {
      return MANIP_SCALE[current];
    },
  };
}
