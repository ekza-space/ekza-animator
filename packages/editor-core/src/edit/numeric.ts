// WP-7a stubs: final signatures (MVP-SPEC §7 WP-7a); bodies throw until numeric input lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelId } from '@ekza-animator/doc';

/** '45', '+=10', '-=5', '*2', '/2', '1.5rad', '90deg'. */
export function parseNumericInput(_text: string, _current: number): number | null {
  throw new EkzaError('not-implemented', 'editor-core.parseNumericInput');
}

/** Degrees for rotations, 3 decimals. */
export function formatChannelValue(_channel: ChannelId, _value: number): string {
  throw new EkzaError('not-implemented', 'editor-core.formatChannelValue');
}

export function toDisplayValue(_channel: ChannelId, _value: number): number {
  throw new EkzaError('not-implemented', 'editor-core.toDisplayValue');
}

export function fromDisplayValue(_channel: ChannelId, _display: number): number {
  throw new EkzaError('not-implemented', 'editor-core.fromDisplayValue');
}
