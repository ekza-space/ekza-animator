// The file name a target saves (AUTORIG-SPEC §5.6, §5.6.4; D6), shown before *Download* ("cube-lad.vrm · ready",
// "2 clips → cube-lad-animations.zip"). `autorig.export` names the file itself (io's `omobaSlug` and `exportFileName`,
// called with `fileName: ''`); the rule is editor-core's `autorigFlow` (T5b, shared with Halo's Share sheet), which
// mirrors io's two rules for the hint, and E2E-AR-07 checks the hint against the saved file's name.
export { exportFileNameOf as expectedFileName, exportSlugOf as slugOf } from '@ekza-studio/editor-core';
