// `@ekza-studio/halo/dev` (T6b; dev and e2e builds only): the test harness of the parts T6b builds before they mount in
// T6a's frame — the Path, the sheets and the parity probe — served by the dev route `/dev-halo` inside the `(studio)`
// group, so the same host and EditorApp survive a switch to `/app`, `/editor` and `/autorig` (the browser parity spec
// takes its census across those mounts). Nothing on `/app`, `/editor` or `/autorig` imports this subpath. Removed at
// integration (T12) once the frame hosts the sheets.
export { HaloT6bHarness } from './Harness';
