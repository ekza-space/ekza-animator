// The shared Tween bar (M2A-SPEC §5.13, §7): mode select, slider, overshoot toggle, target label and presets, mounted
// in the status line and in the Graph Editor and Dope Sheet toolbars. A0 lands the component as an empty stub (it
// renders nothing) so the slots exist; A4 implements it and registers the `tween.<panel>` probe while it is mounted.
import type { JSX } from 'react';
import type { TweenPanel } from '../../shell/types';

export function TweenBar(_props: { readonly panel: TweenPanel }): JSX.Element | null {
  return null;
}
