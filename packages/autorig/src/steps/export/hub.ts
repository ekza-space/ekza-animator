// *Publish to Ekza Hub ▸* (AUTORIG-SPEC §5.6.5; D6): reserved next to *Download* for the VRM target, uploading the same
// bytes to hub.ekza.io once the M4a T3 slice (the `studio-upload` scope) is built and the user is signed in. Until then
// the flag is off and the button is **absent** (M6b's rule: deferred UI is absent, not disabled); the step shows the
// hosted path as a note instead.
export const publishToHub = (): boolean => false;
