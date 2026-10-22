// Help line (research 09 §6.5, Maya help line): transient messages (cancelled commands, hints), otherwise the
// navigation and tool hints; busy state and the selection on the right. Human-speed state only, never per frame.
// M6a (M6A-SPEC §5.17, §8.2; B9): in Model the hints are the mode and the resolved meaning of the modeling keys under
// the pointer (`⌘E Extrude` on macOS, `Ctrl+E Extrude` elsewhere), and the selection counts objects.
import { type ComponentMode, type EditorApp, GLOBAL_SCOPE, PANEL, type SessionState } from '@ekza-studio/editor-core';
import { cn, LoaderCircle } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useEditorApp, usePrefs, useSession } from '../hooks';
import { helpHints } from '../input/keyboard';
import { useShellUi } from './context';

const MODE_LABEL: Readonly<Record<ComponentMode, string>> = {
  object: 'Object mode',
  vertex: 'Vertex mode',
  edge: 'Edge mode',
  face: 'Face mode',
};

const NAV_HINT = {
  maya: 'Alt+LMB tumble · Alt+MMB track · Alt+RMB dolly · wheel zoom',
  trackpad: 'Two-finger scroll tumble · Shift+scroll track · pinch dolly',
  mayaOneButton: 'Option+drag tumble · Option+Cmd+drag track · Option+Ctrl+drag dolly',
} as const;

export const GL_LOST_TEXT = 'Graphics context lost — restoring the 3D view…';

/**
 * Rig & Skin's tool hint and selection count (`hint\u0001count\u0001noun`), registered by the lazy rig shell
 * (`rig/helpLine.ts`), so its texts stay out of the eager bundle; null outside Rig & Skin.
 */
export type RigHelp = (app: EditorApp, state: SessionState) => string | null;
let rigHelp: RigHelp | null = null;
export function setRigHelp(help: RigHelp | null): void {
  rigHelp = help;
}

const TOOL_HINT: Readonly<Record<string, string>> = {
  select: 'Click or drag a marquee to select controls · S set key',
  move: 'Drag an arrow or plane to move · S set key',
  rotate: 'Drag a ring to rotate · S set key',
  scale: 'Drag an axis or the centre cube to scale · S set key',
};

export function HelpLine(): JSX.Element {
  const app = useEditorApp();
  const message = useShellUi((s) => s.help);
  const hover = useShellUi((s) => s.hover);
  const workspace = useSession((s) => s.workspace);
  const mode = useSession((s) => s.model.componentMode);
  const objects = useSession((s) => s.selection.objects.length);
  const shellBusy = useShellUi((s) => s.busy);
  const hoverKind = useShellUi((s) => s.hover?.kind ?? null);
  const glStatus = useShellUi((s) => s.gl.status);
  const busy = useSession((s) => s.busy);
  const tool = useSession((s) => s.tools.viewport);
  const selected = useSession((s) => s.selection.controls.length);
  const rig = useSession((s) => rigHelp?.(app, s))?.split('\u0001') ?? null;
  const navProfile = usePrefs((p) => p.navProfile);
  const spaceBehaviour = usePrefs((p) => p.spaceBehaviour);

  const modelHints = workspace === 'model' ? helpHints(app, hover) : null;
  const toolHint = rig === null || rig[0] === '' ? TOOL_HINT[tool] : rig[0];
  const hint =
    workspace === 'model'
      ? `${MODE_LABEL[mode]}${modelHints === null ? '' : ` · ${modelHints}`}`
      : hoverKind === PANEL.viewport || hoverKind === null || hoverKind === GLOBAL_SCOPE
        ? `${NAV_HINT[navProfile]}${toolHint === undefined ? '' : ` · ${toolHint}`}`
        : `Space: ${spaceBehaviour === 'play' ? 'play / stop' : 'maximize panel'} · ? shortcuts`;
  const count = workspace === 'model' ? objects : rig === null ? selected : Number(rig[1]);
  const noun = workspace === 'model' ? 'object' : rig?.[2];
  const what = noun ? (count === 1 ? noun : `${noun}s`) : null;
  const busyLabel = busy?.label ?? shellBusy;
  // A lost context is a state, not a hint: it takes the help line's text until the context is back (acceptance
  // round 1: /editor kept showing the hover hints while the 3D view was gone).
  const lost = glStatus === 'lost' ? GL_LOST_TEXT : null;

  return (
    <footer
      className="flex h-[var(--size-helpline)] shrink-0 items-center gap-3 border-t border-line bg-header px-2 text-ui-dense text-fg-3"
      data-testid="helpline"
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          (lost !== null || message?.tone === 'warning') && 'text-warn',
          lost === null && message?.tone === 'error' && 'text-danger',
        )}
        data-testid="helpline-text"
        aria-live="polite"
      >
        {lost ?? message?.text ?? hint}
      </span>
      {glStatus === 'unavailable' ? <span className="text-warn">WebGL unavailable — 3D view disabled</span> : null}
      {busyLabel === null || busyLabel === undefined ? null : (
        <span className="flex items-center gap-1.5 text-fg-2" data-testid="helpline-busy">
          <LoaderCircle size={12} className="animate-spin" />
          {busyLabel}
          {busy?.progress === null || busy?.progress === undefined ? null : ` ${Math.round(busy.progress * 100)}%`}
        </span>
      )}
      <span className="ekza-numeric shrink-0" data-testid="helpline-selection">
        {count === 0 ? 'Nothing selected' : `${count}${what === null ? '' : ` ${what}`} selected`}
      </span>
    </footer>
  );
}
