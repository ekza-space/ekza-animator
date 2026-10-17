// Help line (research 09 §6.5, Maya help line): transient messages (cancelled commands, hints), otherwise the
// navigation and tool hints; busy state and the selection on the right. Human-speed state only, never per frame.
import { GLOBAL_SCOPE, PANEL } from '@ekza-animator/editor-core';
import { cn, LoaderCircle } from '@ekza-animator/ui';
import type { JSX } from 'react';
import { usePrefs, useSession } from '../hooks';
import { useShellUi } from './context';

const NAV_HINT = {
  maya: 'Alt+LMB tumble · Alt+MMB track · Alt+RMB dolly · wheel zoom',
  trackpad: 'Two-finger scroll tumble · Shift+scroll track · pinch dolly',
  mayaOneButton: 'Option+drag tumble · Option+Cmd+drag track · Option+Ctrl+drag dolly',
} as const;

const TOOL_HINT: Readonly<Record<string, string>> = {
  select: 'Click or drag a marquee to select controls · S set key',
  move: 'Drag an arrow or plane to move · S set key',
  rotate: 'Drag a ring to rotate · S set key',
};

export function HelpLine(): JSX.Element {
  const message = useShellUi((s) => s.help);
  const shellBusy = useShellUi((s) => s.busy);
  const hoverKind = useShellUi((s) => s.hover?.kind ?? null);
  const glStatus = useShellUi((s) => s.gl.status);
  const busy = useSession((s) => s.busy);
  const tool = useSession((s) => s.tools.viewport);
  const selected = useSession((s) => s.selection.controls.length);
  const navProfile = usePrefs((p) => p.navProfile);

  const hint =
    hoverKind === PANEL.viewport || hoverKind === null || hoverKind === GLOBAL_SCOPE
      ? `${NAV_HINT[navProfile]}${TOOL_HINT[tool] === undefined ? '' : ` · ${TOOL_HINT[tool]}`}`
      : `Space: maximize panel · ? shortcuts`;
  const busyLabel = busy?.label ?? shellBusy;

  return (
    <footer
      className="flex h-[var(--size-helpline)] shrink-0 items-center gap-3 border-t border-line bg-header px-2 text-ui-dense text-fg-3"
      data-testid="helpline"
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          message?.tone === 'warning' && 'text-warn',
          message?.tone === 'error' && 'text-danger',
        )}
        data-testid="helpline-text"
        aria-live="polite"
      >
        {message?.text ?? hint}
      </span>
      {glStatus === 'lost' ? <span className="text-warn">Graphics context lost — restoring…</span> : null}
      {glStatus === 'unavailable' ? <span className="text-warn">WebGL unavailable — 3D view disabled</span> : null}
      {busyLabel === null || busyLabel === undefined ? null : (
        <span className="flex items-center gap-1.5 text-fg-2" data-testid="helpline-busy">
          <LoaderCircle size={12} className="animate-spin" />
          {busyLabel}
          {busy?.progress === null || busy?.progress === undefined ? null : ` ${Math.round(busy.progress * 100)}%`}
        </span>
      )}
      <span className="ekza-numeric shrink-0">{selected === 0 ? 'Nothing selected' : `${selected} selected`}</span>
    </footer>
  );
}
