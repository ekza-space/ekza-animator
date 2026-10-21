// The skin worker (M6B-SPEC §2.1, §5.9; C0 entry, C4 implements it): runs `bindSkin` off the main thread for
// `SkinService.bind`. A lazy entry of its own — the host creates it with `new Worker(new URL('./skin.worker.ts',
// import.meta.url), { type: 'module' })` on the first bind — whose code never enters the editor route:
// `SKIN_WORKER_MARKER` is the check-size marker of the `skin-worker` boundary (≤ 120 kB gzip).

/** `check-size` marker of the skin worker (§2.1). */
export const SKIN_WORKER_MARKER = 'ekza-skin-worker' as const;

/** C0: every request fails `not-implemented` until C4 lands the protocol. */
self.onmessage = (event: MessageEvent<{ readonly id?: unknown }>) => {
  const id = typeof event.data === 'object' && event.data !== null ? (event.data.id ?? null) : null;
  self.postMessage({ id, error: { code: 'not-implemented', message: `skin worker (${SKIN_WORKER_MARKER})` } });
};
