// M6A-SPEC §3 rule 8: every test runs with the kernel debug switch on, so `validateMesh` checks every `end()` of the
// kernel the mesh runtimes load (the test app factories pass `kernelDebug: true` through the fake services as well).
import { setKernelDebug } from '@ekza-animator/mesh-core';

setKernelDebug(true);
