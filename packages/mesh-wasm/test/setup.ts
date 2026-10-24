// M6A-SPEC §3 rule 8: the kernel's debug switch is on in tests, so every `end()` and every whole revision validates.
import { setKernelDebug } from '@ekza-studio/mesh-core';

setKernelDebug(true);
