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
import { ANIMATE_ONLY_REASON } from '../operators/builtin/keymapShadows';
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
 * per app: in Rig & Skin a manipulator drag or a Channels panel edit of controls writes the test pose (never a key,
 * never the document); elsewhere it returns null and the shipped gesture runs.
 */
export type ChannelEditRedirect = (app: EditorApp, label: string) => ChannelEditGesture | null;
const redirects = new Set<ChannelEditRedirect>();

export function registerChannelEditRedirect(redirect: ChannelEditRedirect): Disposer {
  redirects.add(redirect);
  return () => redirects.delete(redirect);
}

/**
 * The gesture a registered redirect opens for this app and label, or null (the shipped gesture runs). In Rig & Skin
 * before the rig-workspace chunk has registered its redirect (a reload straight into Rig & Skin, a failed load), the
 * edit is refused: an inert gesture that writes nothing (never an override or a key, M6B-C7-15) while the chunk loads.
 */
export function redirectedChannelEdit(app: EditorApp, label: string): ChannelEditGesture | null {
  for (const redirect of redirects) {
    const gesture = redirect(app, label);
    if (gesture !== null) return gesture;
  }
  if (app.session.getState().workspace !== 'rig') return null;
  void app.rig.load().catch(() => undefined);
  let active = true;
  const end = (): void => {
    active = false;
  };
  return {
    get active() {
      return active;
    },
    update: () => undefined,
    commit: end,
    cancel: end,
  };
}

/**
 * C7 (§5.17 "keying is impossible in Rig & Skin"): the operators that key, paste or mirror a pose or edit curves. In
 * Rig & Skin the runner and `operators.poll` refuse them before their own poll (whatever the source: keyboard, palette,
 * menus, the Channels panel's "Key Selected", the Graph Editor), so a test pose is never written into the document.
 * Reading curves (copy, the buffer snapshot) stays allowed.
 */
const RIG_KEYING =
  /^(key\.(set|deleteAtFrame|convert|tween)$|pose\.(paste|mirror|mirrorAnimation|plantFeet|resetToRest)$|time\.(insert|delete)Time$|rig\.ikFk\.|graph\.(?!keys\.copy$|buffer\.(snapshot|clear)$))/;

/** The refusal reason when `id` keys or edits curves in Rig & Skin, else null. */
export function rigKeyingRefusal(app: Pick<EditorApp, 'session'>, id: string): string | null {
  if (app.session.getState().workspace !== 'rig') return null;
  return RIG_KEYING.test(id) ? ANIMATE_ONLY_REASON : null;
}

/** §5.24 (research 09 §11.2): below 1024 px Rig & Skin is view-only (test poses and Validation). */
export const RIG_VIEW_ONLY_REASON = 'Open on a larger screen to edit';
const viewOnlyApps = new WeakSet<object>();

/** The rig shell reports a narrow window (< 1024 px) per app; Rig & Skin then refuses document edits. */
export function setRigViewOnly(app: EditorApp, viewOnly: boolean): void {
  if (viewOnly) viewOnlyApps.add(app);
  else viewOnlyApps.delete(app);
}

export function rigViewOnly(app: EditorApp): boolean {
  return app.session.getState().workspace === 'rig' && viewOnlyApps.has(app);
}

/**
 * Why the runner (and `operators.poll`) refuses an operator in Rig & Skin, or null: keying (`rigKeyingRefusal`), or
 * a document edit while the window is narrower than 1024 px.
 */
export function rigRunRefusal(
  app: EditorApp,
  def: { readonly id: string; readonly flags?: { readonly undo?: boolean } },
): string | null {
  const keying = rigKeyingRefusal(app, def.id);
  if (keying !== null) return keying;
  // A typed Channels panel value (`channel.setValues`) is a test pose in Rig & Skin: it stays allowed.
  if (def.flags?.undo === true && def.id !== 'channel.setValues' && rigViewOnly(app)) return RIG_VIEW_ONLY_REASON;
  return null;
}

export interface ChannelSources {
  /** The workspace source of a character ('animate' unless set). */
  source(character: CharacterId): ChannelSource;
  set(character: CharacterId, source: ChannelSource): boolean;
  /**
   * C7 (§5.17, §8.9): the channel values a 'bind' or 'test' character shows instead of curves ⊕ overrides — none
   * (defaults) in Bind, the test pose in Test — or null under 'animate' and 'clip' (the shipped reads apply). The
   * Channels panel and the manipulators read them, so a test drag starts from the pose on screen.
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
