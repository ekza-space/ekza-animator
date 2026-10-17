// The time slider's RMB menu (§4.11.17): items from `TimeSliderController.contextMenu`, grouped by their menu
// group; the 'tangent' group is a submenu. Items whose operator polls false are disabled.
import type { EditorApp } from '@ekza-animator/editor-core';
import { PANEL } from '@ekza-animator/editor-core';
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  readonly args?: unknown;
}

export interface TimelineMenuProps {
  readonly app: EditorApp;
  /** Viewport CSS px of the pointer. */
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuEntry[];
  readonly onClose: () => void;
}

/** `timeline.context.delete` → `delete` (the `timeline-menu-<action>` test id); other ids keep a slug of themselves. */
export function menuAction(id: string): string {
  const prefix = 'timeline.context.';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id.replace(/[^A-Za-z0-9-]+/g, '-');
}

interface Group {
  readonly name: string;
  readonly items: readonly MenuEntry[];
}

function groupItems(app: EditorApp, items: readonly MenuEntry[]): Group[] {
  const groups: { name: string; items: MenuEntry[] }[] = [];
  for (const item of items) {
    const name = app.menus.get(item.id)?.group ?? '';
    const last = groups.at(-1);
    if (last?.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  }
  return groups;
}

const itemClass =
  'flex w-full items-center justify-between gap-6 rounded px-2 py-1 text-left text-fg enabled:hover:bg-header ' +
  'disabled:text-fg-3 focus-visible:bg-header focus-visible:outline-none';

export function TimelineMenu(props: TimelineMenuProps): JSX.Element {
  const { app, items, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const [submenu, setSubmenu] = useState<string | null>(null);

  // Keep the menu inside the viewport (it usually opens upwards from the timeline at the bottom of the window).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    const { width, height } = menu.getBoundingClientRect();
    const view = menu.ownerDocument.defaultView;
    const maxX = (view?.innerWidth ?? width) - width - 4;
    const maxY = (view?.innerHeight ?? height) - height - 4;
    setPosition({ left: Math.max(4, Math.min(props.x, maxX)), top: Math.max(4, Math.min(props.y, maxY)) });
  }, [props.x, props.y]);

  useEffect(() => {
    const menu = menuRef.current;
    const doc = menu?.ownerDocument;
    if (menu === null || doc === undefined) return undefined;
    menu.querySelector<HTMLButtonElement>('button:enabled')?.focus();
    const onPointer = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || !menu.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const view = doc.defaultView;
    doc.addEventListener('pointerdown', onPointer, true);
    doc.addEventListener('keydown', onKey, true);
    view?.addEventListener('blur', onClose);
    view?.addEventListener('resize', onClose);
    return () => {
      doc.removeEventListener('pointerdown', onPointer, true);
      doc.removeEventListener('keydown', onKey, true);
      view?.removeEventListener('blur', onClose);
      view?.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const enabled = (item: MenuEntry): boolean =>
    app.operators.poll(item.op, { panel: PANEL.timeline }, item.args) === true;
  const run = (item: MenuEntry): void => {
    onClose();
    void app.runUntyped(item.op, item.args, { panel: PANEL.timeline });
  };
  const button = (item: MenuEntry): JSX.Element => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      className={itemClass}
      data-testid={`timeline-menu-${menuAction(item.id)}`}
      disabled={!enabled(item)}
      onClick={() => run(item)}
    >
      {item.label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="Time slider"
      data-testid="timeline-menu"
      className="fixed z-50 min-w-48 rounded-md border border-line bg-header p-1 text-xs shadow-lg"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:enabled')];
        const index = buttons.indexOf(e.target as HTMLButtonElement);
        const from = index === -1 && e.key === 'ArrowUp' ? 0 : index;
        const next = buttons[(from + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
        next?.focus();
      }}
    >
      {groupItems(app, items).map((group, index) => (
        <div key={`${group.name}:${index}`}>
          {index > 0 ? <hr className="my-1 border-line" /> : null}
          {group.name === 'tangent' ? (
            <div className="relative" onPointerLeave={() => setSubmenu(null)}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenu === group.name}
                className={itemClass}
                data-testid="timeline-menu-tangent"
                onPointerEnter={() => setSubmenu(group.name)}
                onClick={() => setSubmenu(submenu === group.name ? null : group.name)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') setSubmenu(group.name);
                }}
              >
                Tangent <span aria-hidden="true">▸</span>
              </button>
              {submenu === group.name ? (
                <div
                  role="menu"
                  aria-label="Tangent"
                  className="absolute bottom-0 left-full z-50 ml-1 min-w-32 rounded-md border border-line bg-header p-1 shadow-lg"
                >
                  {group.items.map(button)}
                </div>
              ) : null}
            </div>
          ) : (
            group.items.map(button)
          )}
        </div>
      ))}
    </div>
  );
}
