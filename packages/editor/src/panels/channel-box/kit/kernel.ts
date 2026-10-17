// The editor-core, doc and io helpers the WP-9 data panels call (MVP-SPEC §7 WP-7a, WP-2, WP-4), in one place.
// The stub fallbacks of the parallel build (docs/wp-notes/wp-9.md, D-1) were removed at the v0.3 integration: the
// panels use the kernel's helpers directly, including its numeric-field grammar (research 09 §6.4).
import type { ChannelId } from '@ekza-animator/doc';
import {
  defaultChannelValue as docDefaultChannelValue,
  isRotationChannel as docIsRotationChannel,
} from '@ekza-animator/doc';
import {
  beginChannelEditGesture,
  type ChannelEditGesture,
  formatChannelValue as coreFormatChannelValue,
  fromDisplayValue as coreFromDisplayValue,
  type EditorApp,
  type KeyPolicy,
  parseNumericInput as coreParseNumericInput,
  toDisplayValue as coreToDisplayValue,
} from '@ekza-animator/editor-core';
import { type GlbContainer, readVrmLicense as ioReadVrmLicense, type VrmLicenseInfo } from '@ekza-animator/io';

/** `rx`, `ry`, `rz`: shown in degrees. */
export const isRotationChannel: (channel: ChannelId) => boolean = docIsRotationChannel;

/** 1 for `sx`/`sy`/`sz`, else 0 (the value a reset writes). */
export const defaultChannelValue: (channel: ChannelId) => number = docDefaultChannelValue;

/** Internal units (radians, metres) → display units (degrees for rotations). */
export const toDisplayValue: (channel: ChannelId, value: number) => number = coreToDisplayValue;

/** Display units → internal units. */
export const fromDisplayValue: (channel: ChannelId, display: number) => number = coreFromDisplayValue;

/** Degrees for rotations, three decimals; never `-0.000`. */
export const formatChannelValue: (channel: ChannelId, value: number) => string = coreFormatChannelValue;

/** `toFixed` without a negative zero. */
export function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

/**
 * The numeric-field grammar of research 09 §6.4 (editor-core `parseNumericInput`): `[=]expr`, relative `+=`, `-=`,
 * `*=`, `/=` (and the short `*x`, `/x`), where `expr` has `+ - * / ( )`, decimals, exponents and a `deg`/`°`/`rad`
 * suffix. `current` is the field's value in display units; null for anything else.
 */
export const parseNumericInput: (text: string, current: number) => number | null = coreParseNumericInput;

/** One channel-edit gesture of the edit kernel (Channel Box nudge bursts: one history step). */
export function startChannelEditGesture(
  app: EditorApp,
  label: string,
  opts: { readonly key: KeyPolicy },
): ChannelEditGesture {
  return beginChannelEditGesture(app, label, opts);
}

/** The model's VRM licence; null when the file has none or its meta cannot be read (a panel never fails on content). */
export function readVrmLicense(container: GlbContainer): VrmLicenseInfo | null {
  try {
    return ioReadVrmLicense(container);
  } catch {
    return null;
  }
}
