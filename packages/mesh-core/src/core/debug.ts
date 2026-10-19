// The kernel debug switch (M6A-SPEC §3 rule 8): with it on (every test setup, development and e2e builds through
// `createBrowserServices`), `validateMesh` runs at every `EditMesh.end()` and a problem rolls the edit back and throws
// `EkzaError('invalid-mesh')` naming the op. Off by default; headless packages never read `process`.
import { KERNEL_MARKER } from '../kernel';

let debug = false;

/** §3 rule 8: validate after every commit (tests, development and e2e builds). Default off. */
export function setKernelDebug(on: boolean): void {
  debug = on === true;
}

/** Whether the debug switch is on (kernel modules read it; `KERNEL_MARKER` names the switch's owner). */
export function isKernelDebug(): boolean {
  return debug && KERNEL_MARKER.length > 0;
}
