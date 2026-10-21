// Channel sources of the evaluation (M6B-SPEC §4.6, §5.17, §0.5; C0 baseline, then C7).
//
// C7 (MVP): 'bind' evaluates the channel defaults on the character's program. The MVP compiles no enabled constraint
// (C8a is deferred, §0.3: every constraint record compiles as a disabled op), so that program is the constraint-free
// one `withoutConstraints` would give and the Bind view is the rest pose exactly; C8a swaps in the compiled
// constraint-free program when constraints arrive.
//
// Resolution, in every workspace (Animate included): when the registered 'preview' provider's `values(character)` is
// non-null, those values drive the character (the channel defaults, then the provider's values); otherwise the
// character's workspace source does — 'animate' (clip curves ⊕ session overrides, the shipped path, the default),
// 'bind' (channel defaults: the rest pose; C7 evaluates it with the constraint-free program), 'test' (defaults ⊕ the
// test pose of `app.rig.testPose`) or 'clip' (the clip's curves without overrides). Stopping a preview is the provider
// returning null (and bumping its version): the next tick evaluates the workspace source again, nothing to restore.
import type { Disposer } from '@ekza-studio/anim-core';
import type { ChannelValues, CharacterId, ControlId } from '@ekza-studio/doc';
import type { ChannelBuffer, RigProgram } from '@ekza-studio/rig';
import type { ChannelEditGesture, ChannelSource, ChannelSourceProvider, EditorApp, TestPoseService } from '../types';

const providers: ChannelSourceProvider[] = [];
const NO_VALUES: ReadonlyMap<ControlId, ChannelValues> = new Map();
let registrations = 0;

/** C0 hook (§0.5): C12 registers the provider of the 'preview' source; the last registered provider wins. */
export function registerChannelSourceProvider(source: 'preview', provider: ChannelSourceProvider): Disposer {
  if (source !== 'preview') throw new Error(`registerChannelSourceProvider: unknown source '${String(source)}'`);
  providers.push(provider);
  registrations++;
  return () => {
    const index = providers.lastIndexOf(provider);
    if (index < 0) return;
    providers.splice(index, 1);
    registrations++;
  };
}

/** The preview values of a character (the newest provider with values), or null when no preview drives it. */
export function previewValues(character: CharacterId): ReadonlyMap<ControlId, ChannelValues> | null {
  for (let i = providers.length - 1; i >= 0; i--) {
    const values = (providers[i] as ChannelSourceProvider).values(character);
    if (values !== null) return values;
  }
  return null;
}

/** Changes with every provider frame and every (un)registration: the evaluation re-evaluates when it moves. */
function previewStamp(): number {
  let stamp = registrations * 1_000_003;
  for (const provider of providers) stamp += provider.version;
  return stamp;
}

/**
 * C7 (§5.17): who answers `beginChannelEditGesture` instead of the shipped path. The rig-workspace chunk registers one
 * per app: in Rig & Skin a manipulator drag or a Channel Box edit of controls writes the test pose (never a key, never
 * the document); elsewhere it returns null and the shipped gesture runs.
 */
export type ChannelEditRedirect = (app: EditorApp, label: string) => ChannelEditGesture | null;
const redirects = new Set<ChannelEditRedirect>();

export function registerChannelEditRedirect(redirect: ChannelEditRedirect): Disposer {
  redirects.add(redirect);
  return () => redirects.delete(redirect);
}

/** The gesture a registered redirect opens for this app and label, or null (the shipped gesture runs). */
export function redirectedChannelEdit(app: EditorApp, label: string): ChannelEditGesture | null {
  for (const redirect of redirects) {
    const gesture = redirect(app, label);
    if (gesture !== null) return gesture;
  }
  return null;
}

export interface ChannelSources {
  /** The workspace source of a character ('animate' unless set). */
  source(character: CharacterId): ChannelSource;
  set(character: CharacterId, source: ChannelSource): boolean;
  /**
   * C7 (§5.17, §8.9): the channel values a 'bind' or 'test' character shows instead of curves ⊕ overrides — none
   * (defaults) in Bind, the test pose in Test — or null under 'animate' and 'clip' (the shipped reads apply). The
   * Channel Box and the manipulators read them, so a test drag starts from the pose on screen.
   */
  rigValues(character: CharacterId): ReadonlyMap<ControlId, ChannelValues> | null;
  /** True once after a preview frame or (un)registration since the last call (the evaluation's tick reads it). */
  previewMoved(): boolean;
  /**
   * Fills `channels` for every source but 'animate' (and 'clip', which the caller samples without overrides); returns
   * the source used, so the caller runs the shipped 'animate' path when it says so.
   */
  fill(
    character: CharacterId,
    program: RigProgram,
    channels: ChannelBuffer,
    apply: (values: ReadonlyMap<ControlId, ChannelValues>) => void,
  ): ChannelSource;
}

export function createChannelSources(deps: { readonly testPose: () => TestPoseService | null }): ChannelSources {
  const sources = new Map<CharacterId, ChannelSource>();
  let stamp = previewStamp();
  return {
    source: (character) => sources.get(character) ?? 'animate',
    set(character, source) {
      if ((sources.get(character) ?? 'animate') === source) return false;
      if (source === 'animate') sources.delete(character);
      else sources.set(character, source);
      return true;
    },
    rigValues(character) {
      const source = sources.get(character);
      if (source === 'bind') return NO_VALUES;
      if (source !== 'test') return null;
      return deps.testPose()?.values(character) ?? NO_VALUES;
    },
    previewMoved() {
      const next = previewStamp();
      if (next === stamp) return false;
      stamp = next;
      return true;
    },
    fill(character, program, channels, apply) {
      const preview = previewValues(character);
      if (preview !== null) {
        program.resetChannels(channels);
        apply(preview);
        return 'preview';
      }
      const source = sources.get(character) ?? 'animate';
      if (source === 'bind') program.resetChannels(channels);
      else if (source === 'test') {
        program.resetChannels(channels);
        const pose = deps.testPose()?.values(character);
        if (pose !== undefined && pose.size > 0) apply(pose);
      }
      return source;
    },
  };
}
