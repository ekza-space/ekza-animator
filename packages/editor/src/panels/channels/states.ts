// Channels panel field states (FR-CB-02, research 09 §4.5): standard DCC colours, repeated by a bar shape and a tooltip
// so a state is never shown by colour alone. The `--cb-*` tokens are requested from WP-8's token build (wp-notes R-4);
// the fallbacks are research 09's values.
import type { ChannelState } from '@ekza-studio/editor-core';

export type StateBar = 'solid' | 'thin' | 'dashed' | 'lock' | 'none';

export interface ChannelStateStyle {
  /** Field background. */
  readonly fill: string;
  /** Field text. */
  readonly text: string;
  /** Shape cue at the field's left edge. */
  readonly bar: StateBar;
  /** Tooltip / accessible description. */
  readonly label: string;
}

export const CHANNEL_STATE_STYLE: Readonly<Record<ChannelState, ChannelStateStyle>> = {
  'keyed-on-frame': {
    fill: 'var(--cb-keyed-on, #c8323c)',
    text: 'var(--cb-keyed-on-text, #ffffff)',
    bar: 'solid',
    label: 'Keyed on this frame',
  },
  keyed: {
    fill: 'var(--cb-keyed-off, #7a2e3a)',
    text: 'var(--cb-keyed-off-text, #f3d6db)',
    bar: 'thin',
    label: 'Keyed, no key on this frame',
  },
  changed: {
    fill: 'var(--cb-altered, #f2a5b8)',
    text: 'var(--cb-altered-text, #1b1c1f)',
    bar: 'dashed',
    label: 'Changed since the key, not keyed (S keys it)',
  },
  locked: {
    fill: 'var(--cb-locked, #33353c)',
    text: 'var(--cb-locked-text, #a3a8b2)',
    bar: 'lock',
    label: 'Locked',
  },
  static: {
    fill: 'var(--bg-field, #17181b)',
    text: 'var(--text, #e6e7ea)',
    bar: 'none',
    label: 'Not keyed',
  },
  'non-keyable': {
    fill: 'var(--bg-field, #17181b)',
    text: 'var(--text-3, #969ba6)',
    bar: 'none',
    label: 'Not keyable',
  },
};

/** Tooltip of a field: the state, with the frame for a key on the current frame ("Keyed at f24"). */
export function channelStateTitle(state: ChannelState, clipFrame: number | null): string {
  if (state === 'keyed-on-frame' && clipFrame !== null) {
    return `Keyed at f${Number.isInteger(clipFrame) ? clipFrame : clipFrame.toFixed(2)}`;
  }
  return CHANNEL_STATE_STYLE[state].label;
}
