// Workspace tabs (M6A-SPEC §5.17, §8.1; B9): `Model › Rig & Skin › Animate › Review` in the menu bar, with status
// glyphs that carry text tooltips (never colour alone): ● done, ◐ needs attention (the reasons), ○ nothing yet.
// Disabled tabs say when they arrive. Below 1280 px the labels shorten. A click runs `workspace.set`.
import type { WorkspaceDef, WorkspaceStatus } from '@ekza-animator/editor-core';
import { cn, Tooltip } from '@ekza-animator/ui';
import { Fragment, type JSX, useEffect, useMemo, useState } from 'react';
import { useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { useShell } from './context';

const GLYPH: Readonly<Record<WorkspaceStatus['glyph'], string>> = { done: '●', attention: '◐', todo: '○', none: '' };
const GLYPH_TEXT: Readonly<Record<WorkspaceStatus['glyph'], string>> = {
  done: 'Done',
  attention: 'Needs attention',
  todo: 'Nothing here yet',
  none: '',
};

/** A version that changes whenever the document or a mesh runtime changes (statuses are re-read at human speed). */
function useStatusVersion(): number {
  const { app } = useShell();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const disposers = [app.store.subscribe(bump), app.meshes.subscribe(bump)];
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [app]);
  return version;
}

/** The text of a tab's tooltip: its label, the glyph's meaning and the reasons (or why it is disabled). */
export function tabTooltip(def: WorkspaceDef, status: WorkspaceStatus): string {
  if (!def.enabled) return `${def.label}: ${def.disabledReason ?? 'not available yet'}`;
  const meaning = GLYPH_TEXT[status.glyph];
  const parts = [meaning === '' ? def.label : `${def.label}: ${meaning}`, ...status.reasons];
  return parts.join('\n');
}

export function WorkspaceTabs(): JSX.Element | null {
  const shell = useShell();
  const { app } = shell;
  const registered = useRegistryList(app.workspaces);
  const active = useSession((s) => s.workspace);
  const version = useStatusVersion();
  const tabs = useMemo(() => {
    void version; // statuses are derived: re-read when the document or a mesh changes
    const none: WorkspaceStatus = { glyph: 'none', reasons: [] };
    return [...registered]
      .sort((a, b) => a.order - b.order)
      .map((def) => ({ def, status: def.enabled ? (def.status?.(app) ?? none) : none }));
  }, [registered, app, version]);
  if (tabs.length === 0) return null;

  return (
    <div
      className="flex h-[26px] shrink-0 items-center gap-0.5 rounded border border-line px-0.5"
      role="tablist"
      aria-label="Workspaces"
      data-testid="ws-tabs"
    >
      {tabs.map(({ def, status }, index) => {
        const selected = def.id === active;
        return (
          <Fragment key={def.id}>
            {index === 0 ? null : (
              <span className="text-ui-dense text-fg-3" aria-hidden="true">
                ›
              </span>
            )}
            <Tooltip content={tabTooltip(def, status)}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                aria-disabled={!def.enabled}
                aria-label={`${def.label} workspace${status.glyph === 'none' ? '' : `, ${GLYPH_TEXT[status.glyph].toLowerCase()}`}`}
                data-testid={`ws-tab-${def.id}`}
                data-glyph={status.glyph}
                className={cn(
                  'flex h-[22px] items-center gap-1 rounded px-1.5 text-ui whitespace-nowrap',
                  selected ? 'bg-[var(--bg-pressed,#3a3d46)] text-fg' : 'text-fg-2 hover:bg-[var(--bg-hover,#30323a)]',
                  !def.enabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                )}
                onClick={() => {
                  if (!def.enabled || selected) return;
                  void shell.runFromUi('workspace.set', { workspace: def.id }, { source: 'menu' });
                }}
              >
                <span className="hidden min-[1280px]:inline">{def.label}</span>
                <span className="min-[1280px]:hidden">{def.shortLabel}</span>
                {GLYPH[status.glyph] === '' ? null : (
                  <span className="text-[10px] text-fg-3" data-testid={`ws-glyph-${def.id}`} aria-hidden="true">
                    {GLYPH[status.glyph]}
                  </span>
                )}
              </button>
            </Tooltip>
          </Fragment>
        );
      })}
    </div>
  );
}
