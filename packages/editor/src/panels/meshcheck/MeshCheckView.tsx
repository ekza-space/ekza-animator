// The Mesh Check panel body (M6A-SPEC §5.25, §8.10; B10, a lazy chunk): the checked mesh's problems by code with a
// count and a severity glyph (✕ error, ◇ n-gon, ○ info), "Select" (`select.mesh.matching`: the matching components in
// their kind), the code's fix (`mesh.cleanup {fix}`) and, for `duplicate-slot`, "Swatch" (§5.25 "select swatch":
// `palette.setActive` with the shadowed duplicate, which B13's Palette panel shows as active). While the panel is shown every pane has
// `DisplayFlags.meshCheck` on (panes made later too), so the overlay (driven by that flag in the Model select runtime)
// draws the markers.
// "Clean" = no code except `open-border` on open meshes.
import type { MeshId } from '@ekza-animator/doc';
import { type EditorApp, PANEL, type RunContext } from '@ekza-animator/editor-core';
import type { MeshProblem } from '@ekza-animator/mesh-core';
import { subscribeViewportManager, type ViewportManager, viewportManagerOf } from '@ekza-animator/viewport';
import { type JSX, useEffect, useState } from 'react';
import { useOptionalShell } from '../../shell/context';
import { type CheckRow, checkedMesh, checkRows, duplicateSwatchOf, meshProblems } from './checks';

const GLYPH = { error: '✕', warning: '◇', info: '○' } as const;
const TONE = {
  error: 'text-[var(--lint-error,#ef6b6b)]',
  warning: 'text-[var(--lint-ngon,#e3b34a)]',
  info: 'text-fg-3',
} as const;

/** The check, re-run (once per microtask) when the checked mesh or its problems may have changed. */
function useCheck(app: EditorApp): Result {
  const [result, setResult] = useState(() => evaluate(app));
  useEffect(() => {
    let pending = false;
    const bump = (): void => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        setResult(evaluate(app));
      });
    };
    const offSession = app.session.subscribe((state, previous) => {
      if (
        state.model.hilite !== previous.model.hilite ||
        state.model.componentMode !== previous.model.componentMode ||
        state.selection.objects !== previous.selection.objects
      ) {
        bump();
      }
    });
    const offMeshes = app.meshes.subscribe(bump);
    const offComponents = app.components.subscribe(bump);
    return () => {
      offSession();
      offMeshes();
      offComponents();
    };
  }, [app]);
  return result;
}

interface Result {
  readonly mesh: MeshId | null;
  readonly problems: readonly MeshProblem[];
  readonly rows: readonly CheckRow[];
  readonly unavailable: string | null;
}

function evaluate(app: EditorApp): Result {
  const mesh = checkedMesh(app);
  if (mesh === null) return { mesh, problems: [], rows: [], unavailable: null };
  try {
    const problems = meshProblems(app, mesh) ?? [];
    return { mesh, problems, rows: checkRows(problems), unavailable: null };
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    const reason = code === 'not-implemented' ? 'Mesh Check arrives with the diagnostics package' : String(error);
    return { mesh, problems: [], rows: [], unavailable: reason };
  }
}

/**
 * While shown, every pane draws the markers (`meshCheck` on, turned off again only where the panel turned it on),
 * including panes made while the panel stays open (a layout switch) and a manager that comes after the panel. The
 * Model select runtime pushes every drawn mesh's problems while any pane has the flag (§5.25 overlay).
 */
function useOverlay(app: EditorApp): void {
  useEffect(() => {
    let vm: ViewportManager | null = null;
    let offPanes: (() => void) | null = null;
    /** Panes of `vm` the panel turned the flag on for. */
    const changed = new Set<string>();
    const turnOn = (): void => {
      const manager = vm;
      if (manager === null) return;
      for (const paneId of manager.paneIds()) {
        const state = manager.paneState(paneId);
        if (state === null || state.display.meshCheck) continue;
        changed.add(paneId);
        manager.updatePane(paneId, { display: { ...state.display, meshCheck: true } });
      }
    };
    const attach = (manager: ViewportManager | null): void => {
      if (manager === vm) return;
      // A replaced manager is gone with its panes: nothing to turn off there.
      offPanes?.();
      offPanes = null;
      changed.clear();
      vm = manager;
      if (manager === null) return;
      offPanes = manager.subscribePanes(turnOn);
      turnOn();
    };
    attach(viewportManagerOf(app));
    const offManager = subscribeViewportManager(app, attach);
    return () => {
      offManager();
      offPanes?.();
      const manager = vm;
      if (manager !== null) {
        for (const paneId of changed) {
          const state = manager.paneState(paneId);
          if (state !== null) manager.updatePane(paneId, { display: { ...state.display, meshCheck: false } });
        }
      }
      changed.clear();
      vm = null;
    };
  }, [app]);
}

export default function MeshCheckView(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const shell = useOptionalShell();
  const result = useCheck(app);
  useOverlay(app);
  const ctx: RunContext = { panel: PANEL.viewport, source: 'menu' };
  const run = (op: string, args: unknown): void => {
    if (shell !== null) void shell.runFromUi(op, args, ctx);
    else void app.runUntyped(op, args, ctx);
  };
  const name = result.mesh === null ? null : (app.store.get('meshes', result.mesh)?.name ?? result.mesh);
  // `open-border` is reported only on meshes their template flags closed, where it is a problem (§5.25 "Clean").
  const clean = result.rows.length === 0;
  return (
    <div className="flex h-full flex-col gap-1 overflow-auto p-2 text-[11px] text-fg-2">
      <div className="flex items-center gap-2 text-fg">
        <span className="font-semibold">Mesh Check</span>
        {name === null ? <span className="text-fg-3">No editable mesh</span> : <span>{name}</span>}
        {name !== null && result.unavailable === null ? (
          <span className={clean ? 'text-fg-3' : 'text-[var(--lint-error,#ef6b6b)]'} data-testid="meshcheck-status">
            {clean ? 'Clean' : `${result.rows.length} problem${result.rows.length === 1 ? '' : 's'}`}
          </span>
        ) : null}
      </div>
      {result.unavailable !== null ? <p className="text-fg-3">{result.unavailable}</p> : null}
      <ul className="flex flex-col gap-0.5">
        {result.rows.map((row) => (
          <li
            key={row.code}
            className="flex items-center gap-2"
            data-testid={`meshcheck-row-${row.code}`}
            title={row.message}
          >
            <span className={`w-3 text-center ${TONE[row.severity]}`} aria-label={row.severity}>
              {GLYPH[row.severity]}
            </span>
            <span className="min-w-40 font-mono">{row.code}</span>
            <span className="w-10 text-right tabular-nums">{row.count}</span>
            <button
              type="button"
              className="rounded-sm px-1.5 hover:bg-[var(--bg-pressed,#3a3d46)]"
              data-testid={`meshcheck-select-${row.code}`}
              onClick={() => run('select.mesh.matching', { mesh: result.mesh, code: row.code })}
            >
              Select
            </button>
            {row.code === 'duplicate-slot' && result.mesh !== null ? (
              <button
                type="button"
                className="rounded-sm px-1.5 hover:bg-[var(--bg-pressed,#3a3d46)]"
                data-testid="meshcheck-swatch-duplicate-slot"
                title="Make the duplicate swatch active in the Palette"
                onClick={() => {
                  const swatch = result.mesh === null ? null : duplicateSwatchOf(app, result.mesh);
                  if (swatch !== null) run('palette.setActive', { swatch });
                }}
              >
                Swatch
              </button>
            ) : null}
            {row.fix === null ? null : (
              <button
                type="button"
                className="rounded-sm px-1.5 hover:bg-[var(--bg-pressed,#3a3d46)]"
                data-testid={`meshcheck-fix-${row.code}`}
                onClick={() => run('mesh.cleanup', { meshes: [result.mesh], fix: row.fix, selectOnly: false })}
              >
                Fix
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
