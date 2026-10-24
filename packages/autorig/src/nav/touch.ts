// Two-finger touch navigation (AUTORIG-SPEC §8.1, §8.3; D3): moved into the viewport package as a stage of the
// pointer path (`viewport/src/navigation/touch/pair.ts`, STUDIO-TOUCH-SPEC §20.3 item 1, T1). Re-exported for tests.
export { createTwoFingerStage, type Finger, twoFingerStep } from '@ekza-studio/viewport';
