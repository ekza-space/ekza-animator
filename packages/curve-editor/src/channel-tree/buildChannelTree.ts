// WP-6 stub: final signature (MVP-SPEC §7 WP-6); throws until the channel tree lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ClipId, ControlId } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { ChannelTreeNode } from '../types';

/** Channel swatch colours: research 09 §8.2 `--axis-x/y/z` and `--channel-other`. */
export const CHANNEL_COLORS: { readonly x: string; readonly y: string; readonly z: string; readonly other: string } = {
  x: '#ff5f69',
  y: '#5fd36e',
  z: '#4f8dff',
  other: '#3fd1d9',
};

export function buildChannelTree(
  _app: EditorApp,
  _opts: {
    readonly clip: ClipId | null;
    readonly controls: readonly ControlId[];
    readonly filter?: string;
    readonly onlyAnimated?: boolean;
  },
): ChannelTreeNode[] {
  throw new EkzaError('not-implemented', 'curve-editor.buildChannelTree');
}
