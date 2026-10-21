// The clip library service (M6B-SPEC §0.4.7, §0.5; C12): the starter-pack manifest (fetched once, on the first panel
// open), each clip's bytes (fetched on its first Play or Use Clip, verified against the manifest's size and SHA-256 —
// a mismatch marks the clip failed — and cached per session), and the preview: the 'preview' channel source
// (`evaluation/previewSource.ts`), its frame driver and its stop rules. Part of the clip-library chunk.
//
// Stop rules (§0.4.7): C0's `onBeforeDocumentRun` (every undoable operator — keys, auto-key, Use Clip — and undo/redo),
// any document change (a store batch; a partition load only when it removed the character), a workspace or active
// character switch, an override change (the start of a transform drag or a Channel Box edit), a test-pose write, Esc
// (a global binding to `library.stop` while a preview plays), Stop, and a second Play of the playing card (the panel).
import { type Disposer, EkzaError, sha256Hex } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import { parseStarterPackManifest, type StarterPackClip, type StarterPackManifest } from '@ekza-studio/io';
import { internalsOf } from '../app/internals';
import { ClipPreviewSource, type PreviewClip, registerPreviewSource } from '../evaluation/previewSource';
import type { ClipLibraryService, ClipPreviewState, EditorApp } from '../types';

/** The toast and failure text of a clip whose bytes do not match the manifest (§0.4.7). */
export const CHECKSUM_FAILED = 'The file failed its checksum';
/** Poll reason of `library.stop` without a preview. */
export const NO_PREVIEW = 'No clip preview is playing';
/** The default base URL of the library (§0.5 `EditorServices.libraryPath`). */
export const DEFAULT_LIBRARY_PATH = '/library/';

type Fetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Animation-frame scheduling of the preview's clock (the browser's rAF; absent in Node, where tests step it). */
interface FrameScheduler {
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface ClipLibraryOptions {
  readonly fetch?: Fetch;
  readonly now?: () => number;
  readonly frames?: FrameScheduler | null;
}

const libraries = new WeakMap<EditorApp, ClipLibrary>();

/** The clip library of an app once its chunk is attached (`attachClipLibrary`), else null. */
export function clipLibraryOf(app: EditorApp): ClipLibrary | null {
  return libraries.get(app) ?? null;
}

/** The clip library of an app; throws when the chunk was not attached (operators run after it is). */
export function requireClipLibrary(app: EditorApp): ClipLibrary {
  const library = libraries.get(app);
  if (library === undefined) throw new EkzaError('unavailable', 'The clip library is not loaded');
  return library;
}

function defaultFrames(): FrameScheduler | null {
  const raf = (globalThis as { requestAnimationFrame?: (callback: () => void) => number }).requestAnimationFrame;
  const caf = (globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame;
  if (typeof raf !== 'function' || typeof caf !== 'function') return null;
  return { request: (callback) => raf(callback), cancel: (handle) => caf(handle as number) };
}

export class ClipLibrary implements ClipLibraryService {
  readonly source: ClipPreviewSource;
  private readonly fetchImpl: Fetch;
  private readonly frames: FrameScheduler | null;
  private manifestLoad: Promise<StarterPackManifest> | null = null;
  private loadedManifest: StarterPackManifest | null = null;
  private readonly verified = new Map<string, Promise<Uint8Array>>();
  private readonly failedClips = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private watching: Disposer[] = [];
  private frameHandle: unknown = null;
  private readonly unregister: Disposer;

  constructor(
    private readonly app: EditorApp,
    opts: ClipLibraryOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((url) => globalThis.fetch(url));
    this.frames = opts.frames === undefined ? defaultFrames() : opts.frames;
    const now = opts.now ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
    this.source = new ClipPreviewSource(internalsOf(app).deps.curves.engine, now);
    this.unregister = registerPreviewSource(this.source);
    libraries.set(app, this);
  }

  // ---------- ClipLibraryService ----------

  get preview(): ClipPreviewState | null {
    return this.source.state;
  }

  /** The manifest from `<libraryPath>animations/starter-pack.json`, parsed and cached (a failed load is retried). */
  manifest(): Promise<StarterPackManifest> {
    if (this.manifestLoad === null) {
      const load = this.fetchImpl(`${this.base()}animations/starter-pack.json`)
        .then(async (response) => {
          if (!response.ok)
            throw new EkzaError('unavailable', `The clip library is unavailable (HTTP ${response.status})`);
          return parseStarterPackManifest(await response.json());
        })
        .then((manifest) => {
          this.loadedManifest = manifest;
          this.notify();
          return manifest;
        });
      load.catch(() => {
        if (this.manifestLoad === load) this.manifestLoad = null;
      });
      this.manifestLoad = load;
    }
    return this.manifestLoad;
  }

  /** Verified bytes of one clip (size and SHA-256 against the manifest), cached per session. */
  bytes(clip: string): Promise<Uint8Array> {
    let pending = this.verified.get(clip);
    if (pending === undefined) {
      pending = this.fetchVerified(clip);
      this.verified.set(clip, pending);
      // A network failure is retried by the next call; a checksum failure stays (the card is disabled).
      pending.catch((error: unknown) => {
        if (!(error instanceof EkzaError && error.code === 'checksum')) this.verified.delete(clip);
      });
    }
    return pending;
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------- the chunk's own API (operators, panel, test API) ----------

  /** The manifest once loaded, else null (synchronous readers: labels, the test API). */
  get manifestLoaded(): StarterPackManifest | null {
    return this.loadedManifest;
  }

  /** The manifest entry of a clip id (loads the manifest); throws EkzaError('invalid-input') for an unknown id. */
  async clip(id: string): Promise<StarterPackClip> {
    const manifest = await this.manifest();
    const clip = manifest.clips.find((entry) => entry.id === id);
    if (clip === undefined) throw new EkzaError('invalid-input', `The clip library has no clip '${id}'`);
    return clip;
  }

  /** The label of a clip id from the loaded manifest (null before it loaded or for an unknown id). */
  labelOf(id: string): string | null {
    return this.loadedManifest?.clips.find((entry) => entry.id === id)?.label ?? null;
  }

  /** True when the clip's served bytes failed their checksum this session (its card is disabled). */
  failed(id: string): boolean {
    return this.failedClips.has(id);
  }

  /** Starts (or switches to) a preview: the provider plays it, the stop rules and the frame driver run. */
  startPreview(clip: PreviewClip): void {
    this.unwatch();
    this.source.start(clip);
    this.watch(clip.character);
    this.scheduleFrame();
    this.app.requestFrame();
    this.notify();
  }

  /** Stops the preview; false when none plays. The workspace source applies again at the next frame. */
  stopPreview(): boolean {
    this.unwatch();
    if (!this.source.stop()) return false;
    this.app.requestFrame();
    this.notify();
    return true;
  }

  /** One preview frame at the clock's time (the frame driver's step; tests call it with their clock). */
  stepPreview(): boolean {
    const moved = this.source.frame();
    if (moved) this.app.requestFrame();
    return moved;
  }

  dispose(): void {
    this.stopPreview();
    this.unregister();
    this.listeners.clear();
    if (libraries.get(this.app) === this) libraries.delete(this.app);
  }

  // ---------- internals ----------

  private base(): string {
    const path = this.app.services.libraryPath ?? DEFAULT_LIBRARY_PATH;
    return path.endsWith('/') ? path : `${path}/`;
  }

  private async fetchVerified(id: string): Promise<Uint8Array> {
    const clip = await this.clip(id);
    const response = await this.fetchImpl(`${this.base()}animations/${clip.file}`);
    if (!response.ok) throw new EkzaError('unavailable', `${clip.file} is unavailable (HTTP ${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== clip.bytes || sha256Hex(bytes) !== clip.sha256) {
      this.failedClips.add(id);
      this.notify();
      throw new EkzaError('checksum', CHECKSUM_FAILED, { clip: id });
    }
    return bytes;
  }

  private watch(character: CharacterId): void {
    const app = this.app;
    const stop = (): void => {
      this.stopPreview();
    };
    this.watching.push(
      app.operators.onBeforeDocumentRun(stop),
      app.store.subscribe((batch) => {
        if (batch.origin !== 'load' || app.store.get('characters', character) === undefined) stop();
      }),
      app.session.subscribe((state, previous) => {
        if (
          state.workspace !== previous.workspace ||
          state.activeCharacter !== previous.activeCharacter ||
          state.overrides !== previous.overrides
        ) {
          stop();
        }
      }),
      app.contribute({
        kind: 'keymap',
        bindings: [{ chord: { code: 'Escape' }, op: 'library.stop', scope: 'global' }],
      }),
    );
    if (app.rig.loaded) this.watching.push(app.rig.testPose.subscribe(stop));
  }

  private unwatch(): void {
    for (const dispose of this.watching.splice(0).reverse()) dispose();
    if (this.frameHandle !== null) this.frames?.cancel(this.frameHandle);
    this.frameHandle = null;
  }

  private scheduleFrame(): void {
    const frames = this.frames;
    if (frames === null) return;
    this.frameHandle = frames.request(() => {
      this.frameHandle = null;
      if (this.source.clip === null) return;
      this.stepPreview();
      this.scheduleFrame();
    });
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}
