// The Clip Library's per-app view state (M6B-SPEC §0.4.7; C12), shared by the panel, the Rig Toolkit section, the
// PREVIEW badge and the test API: the manifest's load status (fetched on the first open, never a clip file), the clips
// whose served bytes failed their checksum (their cards turn disabled) and the actions, which run the library
// operators and record a checksum failure. Part of the panel's lazy chunk (and of the lazy test API).
import type { CharacterId } from '@ekza-studio/doc';
import type { EditorApp, OperatorResult } from '@ekza-studio/editor-core';
import type { StarterPackManifest } from '@ekza-studio/io';

/** Failure text of a clip whose bytes do not match the manifest (editor-core's CHECKSUM_FAILED). */
export const CHECKSUM_FAILED = 'The file failed its checksum';
/** The library operators' poll reason for a non-humanoid character. */
export const NEEDS_HUMANOID = 'Clips need a humanoid character';

export interface LibraryView {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly manifest: StarterPackManifest | null;
  readonly error: string | null;
  /** Clip ids whose bytes failed their checksum this session. */
  readonly failed: ReadonlySet<string>;
  /** The clip an action is running for (Play or Use Clip), else null. */
  readonly busy: string | null;
}

interface LibraryState {
  view: LibraryView;
  readonly listeners: Set<() => void>;
  attached: boolean;
}

const states = new WeakMap<EditorApp, LibraryState>();

function stateOf(app: EditorApp): LibraryState {
  let state = states.get(app);
  if (state === undefined) {
    state = {
      view: { status: 'idle', manifest: null, error: null, failed: new Set(), busy: null },
      listeners: new Set(),
      attached: false,
    };
    states.set(app, state);
  }
  return state;
}

function update(app: EditorApp, patch: Partial<LibraryView>): void {
  const state = stateOf(app);
  state.view = { ...state.view, ...patch };
  for (const listener of Array.from(state.listeners)) listener();
}

/** The current view (a new object on every change). */
export function libraryView(app: EditorApp): LibraryView {
  return stateOf(app).view;
}

/**
 * Subscribes to the view and to the library service (its preview starts and stops); the service subscription loads
 * the clip-library chunk.
 */
export function subscribeLibrary(app: EditorApp, listener: () => void): () => void {
  const state = stateOf(app);
  if (!state.attached) {
    state.attached = true;
    app.library.service.subscribe(() => update(app, {}));
  }
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** Loads the manifest once (the first panel open); a failed load can be retried. */
export function loadManifest(app: EditorApp): void {
  const view = stateOf(app).view;
  if (view.status === 'loading' || view.status === 'ready') return;
  update(app, { status: 'loading', error: null });
  app.library.service.manifest().then(
    (manifest) => update(app, { status: 'ready', manifest }),
    (error: unknown) => update(app, { status: 'error', error: error instanceof Error ? error.message : String(error) }),
  );
}

/** The label of a clip id (null before the manifest loaded). */
export function clipLabel(app: EditorApp, clip: string): string | null {
  return stateOf(app).view.manifest?.clips.find((entry) => entry.id === clip)?.label ?? null;
}

function recordFailure(app: EditorApp, clip: string, result: OperatorResult<unknown>): void {
  if (result.status === 'failed' && result.error.message === CHECKSUM_FAILED) {
    const failed = new Set(stateOf(app).view.failed);
    failed.add(clip);
    update(app, { failed });
  } else if (result.status === 'failed') {
    app.services.notify.toast({ kind: 'error', text: result.error.message });
  } else if (result.status === 'cancelled') {
    app.services.notify.toast({ kind: 'warning', text: result.reason });
  }
}

async function act(
  app: EditorApp,
  clip: string,
  op: 'library.preview' | 'library.useClip' | 'library.stop',
  args: unknown,
  panel: string,
): Promise<OperatorResult<unknown>> {
  update(app, { busy: clip });
  try {
    const result = await app.runUntyped(op, args, { panel });
    recordFailure(app, clip, result);
    return result;
  } finally {
    update(app, { busy: null });
  }
}

/** Play/Stop of a card: plays the clip, switches to it, or stops it when it is the one playing. */
export function togglePreview(
  app: EditorApp,
  character: CharacterId,
  clip: string,
  panel: string,
): Promise<OperatorResult<unknown>> {
  const preview = app.library.service.preview;
  if (preview !== null && preview.character === character && preview.clip === clip) {
    return act(app, clip, 'library.stop', undefined, panel);
  }
  return act(app, clip, 'library.preview', { character, clip }, panel);
}

/** Use Clip of a card. */
export function runUseClip(
  app: EditorApp,
  character: CharacterId,
  clip: string,
  panel: string,
): Promise<OperatorResult<unknown>> {
  return act(app, clip, 'library.useClip', { character, clip }, panel);
}
