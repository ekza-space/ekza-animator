// Shell hooks for panels (MVP-SPEC §7 WP-8; the shell ↔ panel bridge documented in docs/wp-notes/wp-8.md). They
// degrade to no-ops when a panel renders without the shell (a bare EditorAppProvider in a unit test).
import type { OperatorResult, RunContext } from '@ekza-animator/editor-core';
import type { ViewportManager } from '@ekza-animator/viewport';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useOptionalShell } from '../shell/context';
import { useEditorApp } from './context';
import type { FrameCallback, HelpMessage, ProbeMap } from '../shell/types';

const noSubscribe = (): (() => void) => () => {};
const nullSnapshot = (): null => null;

/**
 * The ViewportManager the GL host created for the editor's single canvas, or null (no WebGL, not created yet, or
 * no shell). The viewport panel registers its pane surfaces with it.
 */
export function useViewportManager(): ViewportManager | null {
  const shell = useOptionalShell();
  return useSyncExternalStore(
    shell === null ? noSubscribe : shell.ui.subscribe,
    shell === null ? nullSnapshot : () => shell.ui.getState().viewport,
    shell === null ? nullSnapshot : () => shell.ui.getState().viewport,
  );
}

/**
 * Runs `callback` once per editor frame: 'before' with playback and evaluation (before the GL render), 'after' for
 * 2D canvas redraws (R3F `addAfterEffect`). Frames run only when something requested one (`app.requestFrame()`):
 * request a frame after changing what a canvas shows. The latest `callback` is always used.
 */
export function useFrameCallback(phase: 'before' | 'after', callback: FrameCallback): void {
  const shell = useOptionalShell();
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    if (shell === null) return undefined;
    const hook: FrameCallback = (timestamp) => latest.current(timestamp);
    const set = phase === 'before' ? shell.frame.before : shell.frame.after;
    set.add(hook);
    return () => {
      set.delete(hook);
    };
  }, [shell, phase]);
}

/**
 * Publishes a panel's probe for the e2e test API (`screenOfKey`, `screenOfFrame`, `panes()`, …) while mounted.
 * Pass null while the panel has nothing to probe yet.
 */
export function useTestProbe<K extends keyof ProbeMap>(kind: K, probe: ProbeMap[K] | null): void {
  const shell = useOptionalShell();
  useEffect(() => {
    if (shell === null || probe === null) return undefined;
    return shell.probes.set(kind, probe);
  }, [shell, kind, probe]);
}

/**
 * Runs operators the way the shell's own controls do: a failed run becomes an error toast, a cancelled one (poll
 * reason, "gesture in progress", unknown operator) a help-line warning. Without the shell it is `app.runUntyped`.
 */
export function useRunOperator(): (op: string, args?: unknown, ctx?: RunContext) => Promise<OperatorResult<unknown>> {
  const shell = useOptionalShell();
  const app = useEditorApp();
  return useCallback(
    (op: string, args?: unknown, ctx?: RunContext) =>
      shell === null ? app.runUntyped(op, args, ctx) : shell.runFromUi(op, args, ctx),
    [shell, app],
  );
}

/** Shows a transient message in the help line (e.g. "Camera locked — Alt+L to unlock"). */
export function useHelpLine(): (text: string, tone?: HelpMessage['tone']) => void {
  const shell = useOptionalShell();
  return (text, tone) => shell?.help(text, tone);
}
