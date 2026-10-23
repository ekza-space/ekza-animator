// keys_read (MCP-SPEC §6.2 tool 6, §5.5): raw keys of control channels in a frame range — frame, value in the
// channel's unit (degrees, metres, factor), tangent types and flags — paged with an opaque cursor.
import type { InfinityMode } from '@ekza-studio/anim-core';
import type { KeyRecord } from '@ekza-studio/doc';
import { canonicalJson } from '../../manifest/manifest';
import { rangeArg, channelTargets, curveOf, resolveControls } from '../../resolve/targets';
import type { TargetsArg } from '../../resolve/targets';
import { controlKeyOf } from '../../resolve/resolver';
import { CURSOR_MAX, runtimeStateOf } from '../../runtime/runtime';
import { addressed, clipInfo } from '../../runtime/toolkit';
import { outFrame, outValue, toToolValue, unitOfChannel } from '../../units/units';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult } from '../../types';

/** `cycleOffset` → `cycle_offset` (the tools' infinity names, §6.1). */
export function infinityName(mode: InfinityMode): 'constant' | 'linear' | 'cycle' | 'cycle_offset' | 'oscillate' {
  return mode === 'cycleOffset' ? 'cycle_offset' : mode;
}

/** Key flags: b breakdown, k broken tangents, w weighted curve. */
export function keyFlags(key: Pick<KeyRecord, 'breakdown' | 'broken'>, weighted: boolean): string {
  return `${key.breakdown === true ? 'b' : ''}${key.broken ? 'k' : ''}${weighted ? 'w' : ''}`;
}

export interface KeysReadArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly targets: TargetsArg;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly precision: 'display' | 'full';
  readonly cursor?: string | undefined;
  readonly limit: number;
}

type CurveRow = {
  control: string;
  channel: string;
  unit: 'deg' | 'm' | 'factor' | 'none';
  pre: ReturnType<typeof infinityName>;
  post: ReturnType<typeof infinityName>;
  keys: [number, number, string, string, string][];
};

export function keysRead(ctx: AgentToolContext, args: KeysReadArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const range = args.rangeFrames === undefined ? undefined : rangeArg(args.rangeFrames, 'rangeFrames');
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const targets = channelTargets(controls, args.targets.channels, { includeModes: true });
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: controls.map((c) => c.id), frame: null },
    `Read keys (${controls.length} controls)`,
  );
  const state = runtimeStateOf(ctx);
  // The cursor continues the same read: same clip, targets, range, precision and page size — and the same clip
  // revision, so a clip that changed between pages never skips or repeats keys.
  const revision = ctx.revisions.revision(target.clip.id);
  const queryOf = (at: number): string =>
    canonicalJson({
      clip: target.clip.id,
      targets: targets.map((t) => `${t.control.id} ${t.channel}`),
      range: range ?? null,
      precision: args.precision,
      limit: args.limit,
      revision: at,
    });
  const query = queryOf(revision);
  let offset = 0;
  if (args.cursor !== undefined) {
    const cursor = state.cursors.get(args.cursor);
    if (cursor === undefined || cursor.tool !== 'keys_read' || cursor.query !== query) {
      const changed =
        cursor !== undefined && cursor.tool === 'keys_read' && cursor.query === queryOf(cursor.revision ?? -1);
      throw new AgentToolFailure(
        'expired_handle',
        changed
          ? `The clip changed since the first page (revision ${cursor.revision}, now ${revision}).`
          : 'The cursor is unknown, expired or belongs to another read.',
        'repeat the read without cursor',
        changed ? { detail: { expected: cursor.revision, current: revision } } : undefined,
      );
    }
    offset = cursor.offset;
  }
  const rows: CurveRow[] = [];
  let index = 0;
  let listed = 0;
  let more = false;
  for (const t of targets) {
    const curve = curveOf(ctx.app, target.clip.id, t.control.id, t.channel);
    if (curve === undefined) continue;
    const unit = unitOfChannel(t.control, t.channel);
    const keys = ctx.app.store.query
      .keysOfCurve(curve.id)
      .filter((key) => range === undefined || (key.t >= range[0] - 1e-6 && key.t <= range[1] + 1e-6));
    const row: CurveRow = {
      control: controlKeyOf(t.control),
      channel: t.channel,
      unit,
      pre: infinityName(curve.pre),
      post: infinityName(curve.post),
      keys: [],
    };
    for (const key of keys) {
      if (index++ < offset) continue;
      if (listed >= args.limit) {
        more = true;
        break;
      }
      listed++;
      row.keys.push([
        args.precision === 'full' ? key.t : outFrame(key.t),
        outValue(unit, toToolValue(unit, key.v), args.precision),
        key.inType,
        key.outType,
        keyFlags(key, curve.weighted),
      ]);
    }
    // curves without keys on this page are listed on the first page only (their infinities and that they exist)
    if (row.keys.length > 0 || (offset === 0 && keys.length === 0)) rows.push(row);
    if (more) break;
  }
  let cursor: string | null = null;
  if (more) {
    cursor = state.handle('cur');
    state.cursors.set(cursor, { tool: 'keys_read', query, offset: offset + listed, revision });
    while (state.cursors.size > CURSOR_MAX) {
      const oldest = state.cursors.keys().next().value;
      if (oldest === undefined) break;
      state.cursors.delete(oldest);
    }
  }
  return Promise.resolve({
    ok: true,
    data: { curves: rows, cursor, truncated: more },
    clip: clipInfo(ctx, target.clip.id),
    ...(more ? { next: 'More keys follow: call keys_read again with the same arguments and cursor.' } : {}),
  });
}
