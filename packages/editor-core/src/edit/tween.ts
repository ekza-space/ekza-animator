// M2A-SPEC §5.13 tween family: contract stub landed by A0 (§3 rule 1); A4 implements it.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId, KeyId } from '@ekza-animator/doc';
import type { ChannelRef, EditorApp, TweenMode } from '../types';

/** M2a §5.13: target values of a tween; pure (reads the committed state of `app.store` and the session overrides) (A4). */
export function tweenEdits(
  _app: EditorApp,
  _mode: TweenMode,
  _amount: number,
  _target:
    | {
        readonly kind: 'frame';
        readonly controls: readonly ControlId[];
        readonly channels: readonly ChannelRef[] | null;
        readonly frame: Frame;
      }
    | { readonly kind: 'keys'; readonly keys: readonly KeyId[] },
): readonly {
  readonly curve: CurveId | null;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly t: Frame;
  readonly value: number;
}[] {
  throw new EkzaError('not-implemented', 'editor-core.tweenEdits');
}
