// Re-validation of tab results (MCP-SPEC §5.10 "Tab results", §5.19 T16): a result comes from a page, and any page on
// an allowed origin can pose as the editor. The server parses `result` with ITS OWN output schema for the tool
// (unknown fields stripped), re-applies the sanitiser and the tool's budget (`finishResult`), accepts at most one image
// after checking its PNG or WebP signature and that the header's size matches the reported one (≤ 1,568 px, ≤ 8 MiB).
// Workspace writes are not performed here: the protocol has no field for a tab to name a folder, a path or an
// overwrite, and the server derives every target from the call's own arguments (`writeTargets` hook of the link).
import {
  type AgentImage,
  type AgentToolDef,
  type AgentToolResult,
  finishResult,
  outputJsonSchemaOf,
} from '@ekza-studio/agent-tools';
import { z } from 'zod';

/** §5.10: images from a tab. */
export const TAB_IMAGE_LIMITS = { maxEdgePx: 1_568, maxBytes: 8 * 1024 * 1024, maxImages: 1 } as const;

const ERROR_CODES = [
  'invalid_args',
  'not_found',
  'ambiguous',
  'out_of_range',
  'locked_channel',
  'not_keyable',
  'limb_mode',
  'limb_missing',
  'humanoid_only',
  'busy',
  'stale',
  'redo_pending',
  'not_connected',
  'not_granted',
  'paused',
  'declined',
  'confirm_required',
  'expired_handle',
  'read_only',
  'limit',
  'unsupported',
  'poll_failed',
  'denied_operator',
  'cancelled',
  'timeout',
  'version_mismatch',
  'sandbox',
  'exists',
  'io_error',
  'internal',
] as const;

const text = (max: number) => z.string().max(max);
const errorEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: text(2_000),
    hint: text(2_000),
    candidates: z.array(text(500)).max(20).optional(),
    retryable: z.boolean(),
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
});
const successEnvelope = z.object({
  ok: z.literal(true),
  data: z.unknown(),
  clip: z
    .object({
      character: text(500),
      name: text(500),
      fps: z.number().min(0).max(1_000),
      rangeFrames: z.tuple([z.number(), z.number()]),
      loop: z.boolean(),
      revision: z.int().min(0),
    })
    .optional(),
  undo: z.object({ step: z.int().min(0), label: text(500) }).optional(),
  warnings: z.array(text(2_000)).max(50).optional(),
  next: text(2_000).optional(),
});

/** An `internal` failure the agent sees when a tab result does not pass (no tab text in it). */
export function invalidTabResult(why: string): AgentToolResult<unknown> {
  return {
    ok: false,
    error: {
      code: 'internal',
      message: `The editor returned an invalid result (${why}).`,
      hint: 'call the tool again; if it keeps failing, ask the user to reload the editor and pair again',
      retryable: false,
    },
  };
}

/** Image dimensions from a PNG (IHDR) or WebP (VP8, VP8L, VP8X) header; null when the signature is wrong. */
export function imageSize(bytes: Uint8Array, mime: AgentImage['mime']): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 30) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return null;
  const chunk = ascii(12, 16);
  if (chunk === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const b = view.getUint32(21, true);
    return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const w = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
    const h = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

/**
 * The result the agent sees for a tab's `result` message: parsed with the server's own schemas, sanitised and
 * budgeted again; images checked. Never throws.
 */
export function revalidateTabResult(
  tool: AgentToolDef,
  raw: unknown,
  images: readonly AgentImage[] = [],
): AgentToolResult<unknown> {
  const failed = errorEnvelope.safeParse(raw);
  if (failed.success) {
    const error = failed.data.error;
    return finishResult(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint,
          ...(error.candidates === undefined ? {} : { candidates: error.candidates }),
          retryable: error.retryable,
          ...(error.detail === undefined ? {} : { detail: error.detail }),
        },
      },
      null,
    );
  }
  const parsed = successEnvelope.safeParse(raw);
  if (!parsed.success) return invalidTabResult('not a result envelope');
  const data = tool.output.safeParse(parsed.data.data);
  if (!data.success) return invalidTabResult(`not ${tool.name} data`);
  if (images.length > TAB_IMAGE_LIMITS.maxImages) return invalidTabResult('more than one image');
  const checked: AgentImage[] = [];
  for (const image of images) {
    if (image.bytes.length > TAB_IMAGE_LIMITS.maxBytes) return invalidTabResult('image too large');
    if (image.width > TAB_IMAGE_LIMITS.maxEdgePx || image.height > TAB_IMAGE_LIMITS.maxEdgePx) {
      return invalidTabResult('image too large');
    }
    const size = imageSize(image.bytes, image.mime);
    if (size === null) return invalidTabResult('image is not the type it claims');
    if (size.width !== image.width || size.height !== image.height) {
      return invalidTabResult('image size does not match its header');
    }
    checked.push(image);
  }
  const { clip, undo, warnings, next } = parsed.data;
  return finishResult(
    {
      ok: true,
      data: data.data,
      ...(clip === undefined ? {} : { clip: { ...clip, rangeFrames: [clip.rangeFrames[0], clip.rangeFrames[1]] } }),
      ...(undo === undefined ? {} : { undo }),
      ...(checked.length === 0 ? {} : { images: checked }),
      ...(warnings === undefined ? {} : { warnings }),
      ...(next === undefined ? {} : { next }),
    },
    { maxTokens: tool.budget.maxTokens, schema: outputJsonSchemaOf(tool.output) },
  );
}
