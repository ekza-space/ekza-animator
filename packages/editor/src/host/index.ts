// `@ekza-studio/editor/host` (AUTORIG-SPEC §4.4; D0 stub, D1 replaces it): the HostShell both shells mount — the UI
// store, frame hooks, probes, toasts, the dialog host, the keyboard adapter, autosave, the handoff record, the
// navigation port, the overlay port, `PaneView` and the test API — and `StudioHost`, the `(studio)` layout's island.
// D0 lands the subpath, the host entry's check-size marker and the test API's Auto-Rig provider registration.

/** `check-size` marker of the StudioHost entry (§7.2 rule 4): counted as initial on `/editor` and `/autorig`. */
export const STUDIO_HOST_MARKER = 'ekza-studio-host' as const;

export { type AutoRigTestState, provideAutoRigTestState } from '../test-api/autorig';
