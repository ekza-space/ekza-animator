// The operator log of a flow (STUDIO-TOUCH-SPEC §20.7 headless integration, AS-ST-5; T5b): every run the flow issues
// through its host's funnels, in order, with its arguments made comparable (document ids → `chr#1`, `msh#2`… by first
// appearance; bytes → their length), its status, and the document runs it caused (the registry's
// `onBeforeDocumentRun`: every operator with an undo step, a composition's inner runs included). Two shells that run
// the same journey on the same model through `autorigFlow` produce equal logs: the Auto-Rig ①–⑤ log recorded for
// Polybot and Cube Lad is the reference Halo's J1 is compared with (T9). Test and diagnostics code; the shells never
// install it.
import type { Disposer } from '@ekza-studio/anim-core';
import type { AutoRigFlowHost, AutoRigFlowRun } from './host';

/** One run the flow issued. */
export interface AutoRigFlowLogEntry {
  readonly op: string;
  /** Through `run` (the person's) or `quiet` (bookkeeping). */
  readonly via: 'run' | 'quiet';
  /** The comparable arguments (`comparableArgs`); null without any. */
  readonly args: unknown;
  readonly status: 'finished' | 'cancelled' | 'failed';
  /** The document runs during it (operator ids, in order; inner runs of a composition included). */
  readonly document: readonly string[];
}

export interface AutoRigFlowLog {
  /** The host whose funnels record (the flow runs on it). */
  readonly host: AutoRigFlowHost;
  /** The entries so far. */
  entries(): readonly AutoRigFlowLogEntry[];
  /** Document runs outside any flow run (a shell's own runs; empty for a headless journey). */
  outside(): readonly string[];
  readonly stop: Disposer;
}

/** Document id prefixes (`@ekza-studio/doc` `newId`); an asset id is the SHA-256 of its bytes. */
const ID = /^(chr|rig|cns|slv|cam|clp|lay|crv|k|tx|msh|grp|pal|sw|img|skl|jnt)_[0-9A-Za-z]+$/;
const ASSET = /^[0-9a-f]{64}$/;

/** A comparable copy of operator arguments: ids by first appearance, bytes by length, keys sorted. */
export function comparableArgs(args: unknown, tokens: Map<string, string> = new Map()): unknown {
  const token = (id: string, kind: string): string => {
    let found = tokens.get(id);
    if (found === undefined) {
      const n = [...tokens.values()].filter((value) => value.startsWith(`${kind}#`)).length + 1;
      found = `${kind}#${n}`;
      tokens.set(id, found);
    }
    return found;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (ID.test(value)) return token(value, value.slice(0, value.indexOf('_')));
      return ASSET.test(value) ? token(value, 'ast') : value;
    }
    if (value instanceof Uint8Array) return { bytes: value.byteLength };
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) out[key] = walk((value as Record<string, unknown>)[key]);
      return out;
    }
    return value;
  };
  return walk(args);
}

/** Records every run of `host`'s funnels; the returned log's `host` is the one to run the flow on. */
export function recordAutoRigFlow(host: AutoRigFlowHost): AutoRigFlowLog {
  const entries: AutoRigFlowLogEntry[] = [];
  const outside: string[] = [];
  const tokens = new Map<string, string>();
  let open: string[] | null = null;
  const off = host.app.operators.onBeforeDocumentRun((id) => {
    if (open === null) outside.push(id);
    else open.push(id);
  });
  const wrap =
    (via: 'run' | 'quiet', funnel: AutoRigFlowRun): AutoRigFlowRun =>
    async (op, args) => {
      const document: string[] = [];
      const outer = open;
      open = document;
      // in the order the runs start; the status once it ended (a throw counts as failed)
      const entry: { -readonly [K in keyof AutoRigFlowLogEntry]: AutoRigFlowLogEntry[K] } = {
        op,
        via,
        args: args === undefined ? null : comparableArgs(args, tokens),
        status: 'failed',
        document,
      };
      entries.push(entry);
      try {
        const result = await funnel(op, args);
        entry.status = result.status;
        return result;
      } finally {
        if (outer !== null) outer.push(...document);
        open = outer;
      }
    };
  return {
    host: { ...host, run: wrap('run', host.run), quiet: wrap('quiet', host.quiet) },
    entries: () => entries,
    outside: () => outside,
    stop: off,
  };
}

/** A one-line view of an entry (`autorig.rig {"straighten":true} → finished [skel.quickRig.commit, …]`). */
export const formatLogEntry = (entry: AutoRigFlowLogEntry): string =>
  `${entry.op} ${JSON.stringify(entry.args)} → ${entry.status}${
    entry.document.length === 0 ? '' : ` [${entry.document.join(', ')}]`
  }`;
