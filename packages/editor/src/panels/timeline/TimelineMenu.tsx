// The time slider's RMB menu (§4.11.17): items from `TimeSliderController.contextMenu`, grouped by their menu
// group; the 'tangent' group is a submenu. Items whose operator polls false are disabled, with the poll's reason as
// their tooltip.
import type { EditorApp } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useNestedPlacement } from './placement';

export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly op: string;
  readonly args?: unknown;
  /** A toggle item (M2a: Ripple Edit) and whether it is on. */
  readonly checked?: boolean;
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

/** ↑/↓ move the focus among the enabled items of the menu that handles the event (not of nested menus). */
function moveFocus(e: ReactKeyboardEvent<HTMLDivElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  e.stopPropagation();
  const menu = e.currentTarget;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:enabled')].filter(
    (button) => button.closest('[role="menu"]') === menu,
  );
  const index = buttons.indexOf(e.target as HTMLButtonElement);
  const from = index === -1 && e.key === 'ArrowUp' ? 0 : index;
  buttons[(from + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
}

/**
 * A nested menu beside its row: upwards and to the right unless that leaves the viewport. It touches the row, so
 * the pointer can travel into it without leaving the row's hover area. ← or Esc returns to the row.
 */
function Submenu(props: {
  readonly label: string;
  readonly items: readonly MenuEntry[];
  readonly render: (item: MenuEntry) => JSX.Element;
  /** Opened from the keyboard: focus its first item. */
  readonly focusFirst: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const { focusFirst, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  useNestedPlacement(ref);
  useEffect(() => {
    if (focusFirst) ref.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus();
  }, [focusFirst]);
  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={props.label}
      className="absolute bottom-0 left-full z-50 min-w-32 rounded-md border border-line bg-header p-1 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        moveFocus(e);
      }}
    >
      {props.items.map(props.render)}
    </div>
  );
}

export function TimelineMenu(props: TimelineMenuProps): JSX.Element {
  const { app, items, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const [submenu, setSubmenu] = useState<{ readonly group: string; readonly keyboard: boolean } | null>(null);
  const tangentRow = useRef<HTMLButtonElement>(null);

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

  /**
   * Why an item is disabled (its operator's poll reason), null when enabled. Shown as the item's tooltip, as in the
   * menu bar (acceptance fix round 1: Remove Frame was disabled with no word on the key that would be deleted).
   */
  const disabledReason = (item: MenuEntry): string | null => {
    try {
      const result = app.operators.poll(item.op, { panel: PANEL.timeline }, item.args);
      return result === true ? null : result.reason;
    } catch (error) {
      return error instanceof Error ? error.message : 'Not available';
    }
  };
  const run = (item: MenuEntry): void => {
    onClose();
    void app.runUntyped(item.op, item.args, { panel: PANEL.timeline });
  };
  const button = (item: MenuEntry): JSX.Element => {
    const reason = disabledReason(item);
    return item.checked === undefined ? (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        className={itemClass}
        data-testid={`timeline-menu-${menuAction(item.id)}`}
        disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => run(item)}
      >
        {item.label}
      </button>
    ) : (
      <button
        key={item.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={item.checked}
        className={itemClass}
        data-testid={`timeline-menu-${menuAction(item.id)}`}
        disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => run(item)}
      >
        {item.label}
        <span aria-hidden="true" className="text-fg-2">
          {item.checked ? '✓' : ''}
        </span>
      </button>
    );
  };

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
      onKeyDown={moveFocus}
    >
      {groupItems(app, items).map((group, index) => (
        <div key={`${group.name}:${index}`}>
          {index > 0 ? <hr className="my-1 border-line" /> : null}
          {group.name === 'tangent' ? (
            <div className="relative" onPointerLeave={() => setSubmenu(null)}>
              <button
                ref={tangentRow}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenu?.group === group.name}
                className={itemClass}
                data-testid="timeline-menu-tangent"
                onPointerEnter={() => setSubmenu({ group: group.name, keyboard: false })}
                onClick={() => setSubmenu(submenu === null ? { group: group.name, keyboard: false } : null)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  setSubmenu({ group: group.name, keyboard: true });
                }}
              >
                Tangent <span aria-hidden="true">▸</span>
              </button>
              {submenu?.group === group.name ? (
                <Submenu
                  label="Tangent"
                  items={group.items}
                  render={button}
                  focusFirst={submenu.keyboard}
                  onClose={() => {
                    setSubmenu(null);
                    tangentRow.current?.focus();
                  }}
                />
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
