// The library preview's channel source (M6B-SPEC §0.4.7 "Preview", §0.5; C12): the provider of the 'preview' source,
// registered through C0's hook (`registerChannelSourceProvider`). While a clip plays it returns the clip's channel
// values for its character at the preview's own clock (C0's resolution gives them priority over the workspace's
// source in every workspace); stopping is returning null and bumping the version, so the workspace source applies
// again with nothing to restore. It never writes the document, the history, `session.overrides`, the test pose or the
// current time. Loaded with the clip-library chunk only.
import type { CompiledAnimCurve, CurveEngine, Disposer } from '@ekza-studio/anim-core';
import type { ChannelId, ChannelValues, CharacterId, ControlId } from '@ekza-studio/doc';
import type { ChannelSourceProvider, ClipPreviewState } from '../types';
import { registerChannelSourceProvider } from './rigSource';

/** One channel of a previewed clip: a compiled curve, or a constant (a curve without keys). */
export interface PreviewChannel {
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly curve: CompiledAnimCurve | null;
  readonly value: number;
}

/** A clip converted onto a character's rig, ready to play (the shipped VRMA import's keys, never written). */
export interface PreviewClip {
  readonly character: CharacterId;
  /** The library clip id (`walk`). */
  readonly clip: string;
  /** Clip frames per second, and the clip's range in clip frames. */
  readonly fps: number;
  readonly start: number;
  readonly end: number;
  /** The manifest's loop flag (shown; the preview itself always loops). */
  readonly loop: boolean;
  readonly channels: readonly PreviewChannel[];
}

/**
 * The 'preview' provider of one app: `start` plays a clip in a loop from 0 s, `frame` advances its clock (the frame
 * driver calls it once per animation frame; tests call it with their own clock), `stop` ends it. `version` bumps on
 * every frame, start and stop (C0's evaluation re-evaluates when it moves).
 */
export class ClipPreviewSource implements ChannelSourceProvider {
  version = 0;
  private playing: PreviewClip | null = null;
  private startedAt = 0;
  private seconds = 0;
  private current: Map<ControlId, ChannelValues> = new Map();

  constructor(
    private readonly engine: CurveEngine,
    private readonly now: () => number,
  ) {}

  values(character: CharacterId): ReadonlyMap<ControlId, ChannelValues> | null {
    return this.playing !== null && this.playing.character === character ? this.current : null;
  }

  get state(): ClipPreviewState | null {
    const playing = this.playing;
    if (playing === null) return null;
    return {
      character: playing.character,
      clip: playing.clip,
      seconds: this.seconds,
      duration: durationOf(playing),
      loop: playing.loop,
    };
  }

  get clip(): PreviewClip | null {
    return this.playing;
  }

  start(clip: PreviewClip): void {
    this.playing = clip;
    this.startedAt = this.now();
    this.sample(0);
  }

  /** Advances the clock to `now()` (looping) and samples the clip; false when nothing plays. */
  frame(): boolean {
    const playing = this.playing;
    if (playing === null) return false;
    const duration = durationOf(playing);
    const elapsed = Math.max(0, (this.now() - this.startedAt) / 1000);
    this.sample(duration > 0 ? elapsed % duration : 0);
    return true;
  }

  stop(): boolean {
    if (this.playing === null) return false;
    this.playing = null;
    this.current = new Map();
    this.seconds = 0;
    this.version++;
    return true;
  }

  private sample(seconds: number): void {
    const playing = this.playing as PreviewClip;
    this.seconds = seconds;
    const frame = Math.min(playing.end, playing.start + seconds * playing.fps);
    const values = new Map<ControlId, Record<string, number>>();
    for (const channel of playing.channels) {
      let entry = values.get(channel.control);
      if (entry === undefined) {
        entry = {};
        values.set(channel.control, entry);
      }
      entry[channel.channel] = channel.curve === null ? channel.value : this.engine.evaluate(channel.curve, frame);
    }
    this.current = values;
    this.version++;
  }
}

/** Seconds from the clip's first to its last frame. */
export function durationOf(clip: Pick<PreviewClip, 'fps' | 'start' | 'end'>): number {
  return clip.fps > 0 ? Math.max(0, clip.end - clip.start) / clip.fps : 0;
}

/** Registers a preview provider as the 'preview' channel source (C0's hook). */
export function registerPreviewSource(source: ClipPreviewSource): Disposer {
  return registerChannelSourceProvider('preview', source);
}
