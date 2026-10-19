// M6A-SPEC §3 rule 8: every kernel test runs with the debug switch on, so `validateMesh` checks every `end()`.
import { setKernelDebug } from '../src';

setKernelDebug(true);
