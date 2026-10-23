// Contract file: MCP-SPEC §4.4 (shapes normative; change the spec first). The functions the contract declares at the
// end of §4.4 live in their own modules and are exported from the package root: `createAgentToolRuntime`
// (runtime/runtime.ts), `allTools` (tools/catalogue.ts), `buildManifest` and `canonicalJson` (manifest/manifest.ts),
// `sanitizeText` (sanitize/sanitize.ts).
import type { CharacterId, ClipId, ControlId, CurveId } from '@ekza-studio/doc';
import type { AgentAccess, EditorApp, OperatorResult, RunActor, RunScope } from '@ekza-studio/editor-core';
import type { z } from 'zod';

export const AGENT_TOOLSET_VERSION = '1.0.0-dev.b1'; // semver; bumped by every manifest change (§5.21; MAI-D0-12, MAI-P2-1)
export type AgentHostMode = 'live' | 'headless';
export type Grant = 'read' | 'edit' | 'files' | 'view';
export interface Grants {
  readonly read: true; // implied by pairing
  readonly edit: boolean;
  readonly files: boolean;
  readonly view: boolean;
  readonly workspace: boolean; // live only: Files may move bytes to/from the agent's workspace folder
}
/** The grant a call needs (§5.9). 'pairing' = callable before any project exists. */
export type ToolAccess = Grant | 'pairing';
/** A grant a call can need besides its `access` (Read is implied by pairing). */
export type ExtraGrant = Exclude<Grant, 'read'>;
export type ToolGroup =
  | 'connection'
  | 'scene'
  | 'pose'
  | 'keys'
  | 'curves'
  | 'clip'
  | 'analyze'
  | 'view'
  | 'history'
  | 'files'
  | 'operators'
  | 'recipes'; // catalogue order (§6)
export type HostCapability =
  | 'capture.shaded'
  | 'capture.schematic' // fidelities
  | 'files.download'
  | 'files.workspace' // live delivery / workspace read-write
  | 'user' // a user session exists (live, or the eval harness's simulated user):
  // selection, playhead, overrides; edits then require `clip` (§5.1)
  | 'confirm' // the host can ask the user (live); headless uses `confirm: true` args
  | 'presence'
  | 'view';

export interface AgentToolDef<I extends z.ZodObject = z.ZodObject, O extends z.ZodType = z.ZodType> {
  readonly name: string; // ^[a-z][a-z0-9_]{2,39}$, `<noun>_<verb>` (§6, §5.20.1)
  readonly title: string;
  readonly description: string; // ≤ 1,500 characters; first sentence says when to use it
  readonly group: ToolGroup;
  readonly input: I; // z.strictObject root (and every nested object), no root combinators
  readonly output: O; // the envelope's `data` (§5.3)
  readonly annotations: { readonly readOnly: boolean; readonly destructive: boolean; readonly idempotent: boolean };
  /** The grant a call needs; a function when it depends on the arguments (pose_set {key:'pose_only'} → 'view'). */
  readonly access: ToolAccess | ((args: z.output<I>, host: AgentHostMode) => ToolAccess);
  /**
   * Grants a call needs besides `access` (§5.9, Q-AI-38): a call that edits the document and changes what the user
   * sees needs Edit and View (clip_create {activate: true} live; operator_run clip.new/clip.duplicate {activate: true}
   * live). The manifest states such a tool's access as `by_argument` (or `by_operator`).
   */
  readonly extraGrants?: (args: z.output<I>, host: AgentHostMode) => readonly ExtraGrant[];
  /** A minimal valid call (§5.4): `invalid_args` carries it in `detail.example`; it must parse against `input`. */
  readonly example?: Readonly<Record<string, unknown>>;
  readonly hosts: readonly AgentHostMode[];
  readonly needs?: readonly HostCapability[]; // missing → `unsupported` with a hint
  readonly alwaysLoad: boolean; // → _meta['anthropic/alwaysLoad'] (the always-loaded profile, §5.20.1)
  readonly requiresUserInteraction?: boolean; // → _meta['anthropic/requiresUserInteraction'] (editor_connect only)
  readonly stretch: boolean; // false = a core tool (§1.1), whatever `alwaysLoad` says
  readonly ready: boolean; // false: not listed (D0 stubs, unbuilt stretch tools)
  readonly kind: 'read' | 'edit' | 'files'; // queueing class (§5.8): reads run at once, the rest in order
  readonly budget: {
    readonly tokens: number;
    readonly maxTokens: number;
    readonly image?: { readonly maxEdgePx: number };
  };
  /** Consequential calls (§5.9): the prompt the host shows; headless calls need `confirm: true` instead. */
  confirm?(ctx: AgentToolContext, args: z.output<I>): ConfirmPrompt | null;
  run(ctx: AgentToolContext, args: z.output<I>): Promise<AgentToolResult<z.output<O>>>;
}
export interface ConfirmPrompt {
  readonly title: string; // 'Delete clip "walk"?'
  readonly detail: string; // what will be lost; 'Undo restores it.'
  readonly danger: boolean;
}

export interface AgentToolContext {
  readonly app: EditorApp;
  readonly host: AgentHost;
  readonly actor: RunActor;
  readonly signal: AbortSignal;
  readonly resolve: Resolver;
  readonly revisions: RevisionTracker;
  /** app.runUntyped with { source: 'api', actor, signal, runScope, access }, after the gesture and redo waits (§5.8);
   *  the operator's `label` argument is the tool's label with the call's sanitised `intent` (§5.6). */
  run(
    id: string,
    args: unknown,
    opts?: { readonly runScope?: RunScope; readonly access?: AgentAccess },
  ): Promise<OperatorRun>;
  progress(done: number, total: number | null, message?: string): void;
  /** Live presence: focus and activity of this actor (no-op headless). */
  focus(
    focus: {
      readonly character: CharacterId | null;
      readonly clip: ClipId | null;
      readonly controls: readonly ControlId[];
      readonly frame: number | null;
    },
    activity: string,
  ): void;
}
export interface OperatorRun {
  readonly result: OperatorResult<unknown>;
  readonly step: { readonly id: number; readonly label: string } | null; // the history step it recorded
  readonly warnings: readonly string[]; // toasts raised during the run
}

export interface AgentHost {
  readonly mode: AgentHostMode;
  readonly capabilities: ReadonlySet<HostCapability>;
  grants(): Grants; // headless: { read, edit, files: true, view: false, workspace: true }
  paused(): boolean;
  /** Resolves when no store preview and no mesh preview session is active, or false after `maxMs`. */
  waitForGesture(signal: AbortSignal, maxMs: number): Promise<boolean>;
  /** Live (and the eval harness's simulated user): the confirm card (§7.4). Headless: never called (tools check
   *  `confirm: true`). `resolvedWhen` is re-checked on every history change; when it turns true the card closes and
   *  the answer is 'resolved' (the redo wait of §5.12). */
  confirm(
    prompt: ConfirmPrompt,
    signal: AbortSignal,
    opts?: { readonly resolvedWhen?: () => boolean },
  ): Promise<'allow' | 'deny' | 'timeout' | 'resolved'>;
  readonly files: AgentFileHost | null;
}
export interface AgentFileHost {
  /** Workspace read (sandboxed, §5.17.3). Live: bytes the server attached to the call for that path (the server
   *  attaches only paths taken from this call's own arguments, and only while the tab reports Files + Workspace). */
  read(path: string): Promise<{ readonly path: string; readonly bytes: Uint8Array }>;
  /** Workspace write. Live: queued; the server writes after the result, to the path **it** derived from this call's
   *  arguments (never a tab-supplied path or overwrite flag, §5.10), and reports failures as the call's error. */
  write(path: string, bytes: Uint8Array, opts: { readonly overwrite: boolean }): Promise<{ readonly path: string }>;
  /** Live only: browser download after the editor's confirm. */
  download?(
    fileName: string,
    bytes: Uint8Array,
    mime: string,
    signal: AbortSignal,
  ): Promise<{ readonly accepted: boolean }>;
}

export interface AgentImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/webp';
  readonly width: number;
  readonly height: number;
}
export interface UndoInfo {
  readonly step: number;
  readonly label: string;
}
export interface ClipInfo {
  readonly character: string;
  readonly name: string;
  readonly fps: number;
  readonly rangeFrames: readonly [number, number];
  readonly loop: boolean;
  readonly revision: number;
}
export type AgentToolResult<D> =
  | {
      readonly ok: true;
      readonly data: D;
      readonly clip?: ClipInfo;
      readonly undo?: UndoInfo;
      readonly images?: readonly AgentImage[];
      readonly warnings?: readonly string[];
      readonly next?: string;
    }
  | { readonly ok: false; readonly error: AgentToolError };
export type AgentErrorCode =
  | 'invalid_args'
  | 'not_found'
  | 'ambiguous'
  | 'out_of_range'
  | 'locked_channel'
  | 'not_keyable'
  | 'limb_mode'
  | 'limb_missing'
  | 'humanoid_only'
  | 'busy'
  | 'stale'
  | 'redo_pending'
  | 'not_connected'
  | 'not_granted'
  | 'paused'
  | 'declined'
  | 'confirm_required'
  | 'expired_handle'
  | 'read_only'
  | 'limit'
  | 'unsupported'
  | 'poll_failed'
  | 'denied_operator'
  | 'cancelled'
  | 'timeout'
  | 'version_mismatch'
  | 'sandbox'
  | 'exists'
  | 'io_error'
  | 'internal';
export interface AgentToolError {
  readonly code: AgentErrorCode;
  readonly message: string; // one sentence, what failed (document strings quoted and sanitised, §5.3)
  readonly hint: string; // what to do next, naming a tool or an argument
  readonly candidates?: readonly string[]; // ≤ 5 ('fk.hand.L (L Hand, leftHand)'), each sanitised
  readonly retryable: boolean;
  readonly detail?: Readonly<Record<string, unknown>>; // e.g. { path: 'set[2].rotateDeg.x' }, { operatorReason }
}

export interface Resolver {
  character(ref?: string): { readonly id: CharacterId; readonly name: string };
  clip(character: CharacterId, ref?: string): { readonly id: ClipId; readonly name: string };
  control(
    character: CharacterId,
    ref: string,
    want?: 'fk' | 'ik',
  ): { readonly id: ControlId; readonly key: string; readonly name: string };
  bone(character: CharacterId, ref: string): { readonly name: string; readonly humanoid: string | null };
  bodyPartControls(character: CharacterId, parts: readonly string[]): readonly ControlId[];
  /** Throws AgentToolFailure('not_found' | 'ambiguous', …, candidates). */
}
export interface RevisionTracker {
  // one per runtime = one per actor (a tab or a headless project)
  revision(clip: ClipId): number; // bumped by every committed batch touching the clip or its curves/keys
  /** Every result that carries `clip` (reads and writes) marks the revision this actor has seen. */
  markSeen(clip: ClipId): void;
  /** `expected` given (`ifClipRevision`): throws AgentToolFailure('stale') unless it is the current revision.
   *  Absent: the automatic check (§5.12) — throws 'stale' when this write touches a curve (or the clip record) that
   *  another writer changed since this actor last saw the clip; returns a warning when only other curves changed;
   *  null when nothing changed. Remembers the last 1,024 batches per clip (older history → warning only). */
  check(
    clip: ClipId,
    expected: number | undefined,
    touches: { readonly curves: readonly CurveId[] | 'all'; readonly clipRecord: boolean },
  ): string | null;
}

/** Errors whose cause is the call itself; the rest are `retryable: false` unless stated (§5.4 table). */
const RETRYABLE: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  'invalid_args',
  'not_found',
  'ambiguous',
  'out_of_range',
  'locked_channel',
  'not_keyable',
  'limb_mode',
  'busy',
  'stale',
  'not_connected',
  'confirm_required',
  'expired_handle',
  'limit',
  'cancelled',
  'exists',
]);

/** Whether an error code is retryable by default (§5.4); `poll_failed` is "maybe" and defaults to true. */
export function isRetryableByDefault(code: AgentErrorCode): boolean {
  return RETRYABLE.has(code) || code === 'poll_failed';
}

/** Thrown inside run(); the runtime turns it into { ok: false, error }. */
export class AgentToolFailure extends Error {
  readonly code: AgentErrorCode;
  readonly hint: string;
  readonly candidates: readonly string[] | undefined;
  readonly retryable: boolean;
  readonly detail: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: AgentErrorCode,
    message: string,
    hint: string,
    opts?: { candidates?: readonly string[]; retryable?: boolean; detail?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AgentToolFailure';
    this.code = code;
    this.hint = hint;
    this.candidates = opts?.candidates;
    this.retryable = opts?.retryable ?? isRetryableByDefault(code);
    this.detail = opts?.detail;
  }

  /** The error part of the envelope (§5.3), before sanitising. */
  toError(): AgentToolError {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      ...(this.candidates === undefined ? {} : { candidates: this.candidates }),
      retryable: this.retryable,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

// ---------- runtime ----------
export interface AgentToolRuntime {
  readonly tools: readonly AgentToolDef[]; // catalogue order (§6), ready tools only
  /** Validates (zod), checks hosts/needs/grants/pause/confirm, queues (§5.8), runs, budgets the result (§5.5). */
  call(
    name: string,
    rawArgs: unknown,
    opts: {
      readonly signal: AbortSignal;
      readonly progress?: (done: number, total: number | null, message?: string) => void;
    },
  ): Promise<AgentToolResult<unknown>>;
}
export interface AgentToolRuntimeOptions {
  readonly app: EditorApp;
  readonly host: AgentHost;
  readonly actor: RunActor;
  readonly gestureWaitMs?: number; // default 15,000
  readonly confirmTimeoutMs?: number; // default 50,000
  /**
   * D0 addition (MAI-D0-2, docs/wp-notes/mcp-contracts-foundation.md): the tool set this runtime serves; default
   * `allTools()`. Tests pass their own definitions; `tools` lists only the ready ones either way.
   */
  readonly tools?: readonly AgentToolDef[];
}

// ---------- manifest (contract file tools.manifest.json) ----------
export interface ToolManifest {
  readonly toolset: string; // AGENT_TOOLSET_VERSION
  readonly hash: string; // sha256 hex of canonicalJson(tools)
  readonly tools: readonly ManifestTool[]; // ready tools, catalogue order
}
export interface ManifestTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly group: ToolGroup;
  readonly access: ToolAccess | 'by_argument' | 'by_operator';
  readonly hosts: readonly AgentHostMode[];
  readonly alwaysLoad: boolean;
  readonly requiresUserInteraction: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>; // z.toJSONSchema(input, { io: 'input' }), draft 2020-12
  readonly outputSchema: Readonly<Record<string, unknown>>; // z.toJSONSchema(envelope, { io: 'output' }): the success envelope (§5.3)
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
}
