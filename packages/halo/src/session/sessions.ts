// Modal tool sessions (STUDIO-TOUCH-SPEC §5.7, P15, ST-34): Multi-Cut, Loop cut, Weld to…, Slide, the extrude cap,
// pivot edit and — registered by their stage packages — the rig dots, weight painting and the test pose. Each shows
// the session bar `✕ Cancel · tool · hint · ✓ Done` (plus ⌫ and − n + where they apply), which replaces Esc, Enter,
// Backspace, the right-click finish and PgUp/PgDn. **Leaving commits**: a stage switch, ▤ Pro layout, Share or Home run
// ✓ Done; only ✕ discards, and above three steps it asks first, naming them. Tools get their keys through the
// viewport's own tool-key path (`ViewportManager.activeTool().key`, the bridge the keyboard uses), so their
// semantics stay Studio Pro's.
import type { EditorApp, ToolId } from '@ekza-studio/editor-core';
import { PANEL, VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { ViewportManager } from '@ekza-studio/viewport';
import { en } from '../i18n/en';
import type { ShellContext } from '../shell/context';
import { STAGE_BASICS } from '../shell/stage';

export interface SessionDef {
  readonly id: string;
  /** Whether this session is open now. */
  active(app: EditorApp): boolean;
  readonly label: string;
  readonly hint: string;
  /** ✓ Done (Enter): keeps the work. */
  done(ctx: ShellContext): Promise<void> | void;
  /** ✕ Cancel (Esc): discards the session's work. */
  cancel(ctx: ShellContext): Promise<void> | void;
  /** ⌫: removes the last point (Multi-Cut). */
  readonly backspace?: (ctx: ShellContext) => void;
  /** − n +: the tool's count (PgDn / PgUp). */
  readonly count?: (ctx: ShellContext, delta: 1 | -1) => void;
  /** Undo steps the session made so far (✕ asks above three, §5.7). */
  readonly steps?: (ctx: ShellContext) => number;
}

/** Sends a key to the active viewport tool through its key path (down then up), as the keyboard bridge does. */
export function toolKey(vm: ViewportManager | null, code: string): boolean {
  const tool = vm?.activeTool() ?? null;
  if (tool?.key === undefined) return false;
  const base = { code, shift: false, alt: false, mod: false, ctrl: false, repeat: false };
  const used = tool.key({ type: 'down', ...base });
  tool.key({ type: 'up', ...base });
  return used;
}

/** Back to the stage's default tool (the session's tool ends). */
async function stageTool(ctx: ShellContext): Promise<void> {
  const tool = STAGE_BASICS[ctx.store.get().stage].tool;
  if (ctx.app.session.getState().tools.viewport === tool) return;
  await ctx.run('view.tool', { panel: PANEL.viewport, tool });
}

function toolSession(tool: ToolId, words: readonly [string, string], extra: Partial<SessionDef> = {}): SessionDef {
  return {
    id: tool,
    active: (app) => app.session.getState().tools.viewport === tool,
    label: words[0],
    hint: words[1],
    async done(ctx) {
      toolKey(ctx.vm(), 'Enter');
      await stageTool(ctx);
    },
    async cancel(ctx) {
      toolKey(ctx.vm(), 'Escape');
      await stageTool(ctx);
    },
    ...extra,
  };
}

const words = (id: string): readonly [string, string] => en.session.tools[id] ?? [id, ''];

/** The sessions the grammar knows; stage packages add theirs (`registerSession`). */
const BUILT_IN: readonly SessionDef[] = [
  {
    id: 'extrude',
    active: (app) => app.session.getState().model.extrudeSession !== null,
    label: words('extrude')[0],
    hint: words('extrude')[1],
    done(ctx) {
      ctx.app.extrude.end('halo.done', { drop: false });
    },
    async cancel(ctx) {
      ctx.app.extrude.end('halo.cancel', { drop: false });
      await ctx.run('edit.undo');
    },
  },
  {
    id: 'pivot',
    active: (app) => app.session.getState().model.pivotEdit,
    label: words('pivot')[0],
    hint: words('pivot')[1],
    async done(ctx) {
      await ctx.run('model.pivot.editToggle');
    },
    async cancel(ctx) {
      await ctx.run('model.pivot.editToggle');
    },
  },
  toolSession(VIEWPORT_TOOL.multiCut, words('multiCut'), {
    backspace: (ctx) => void toolKey(ctx.vm(), 'Backspace'),
  }),
  toolSession(VIEWPORT_TOOL.insertLoop, words('insertLoop'), {
    count: (ctx, delta) => void toolKey(ctx.vm(), delta > 0 ? 'PageUp' : 'PageDown'),
  }),
  toolSession(VIEWPORT_TOOL.targetWeld, words('targetWeld')),
  toolSession(VIEWPORT_TOOL.slide, words('slide')),
];

const registered = new WeakMap<EditorApp, SessionDef[]>();

/** A stage package's session (the rig dots, weight painting, the test pose); the disposer removes it. */
export function registerSession(app: EditorApp, def: SessionDef): () => void {
  const list = registered.get(app) ?? [];
  list.push(def);
  registered.set(app, list);
  return () => {
    const current = registered.get(app);
    if (current !== undefined)
      registered.set(
        app,
        current.filter((d) => d !== def),
      );
  };
}

/** The open session, if any (the most specific first: registered ones, then the built-in table). */
export function activeSession(app: EditorApp): SessionDef | null {
  for (const def of registered.get(app) ?? []) if (def.active(app)) return def;
  for (const def of BUILT_IN) if (def.active(app)) return def;
  return null;
}

/** P15: leaving commits — ✓ Done of the open session (stage switch, Pro layout, Share, Home). */
export async function commitSession(ctx: ShellContext): Promise<void> {
  const session = activeSession(ctx.app);
  if (session !== null) await session.done(ctx);
}
