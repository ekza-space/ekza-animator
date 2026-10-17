// Context menus of the data panels (RMB): a small ARIA menu rendered into document.body at the pointer. A stand-in
// until `@ekza-animator/ui` ships the Radix ContextMenu primitive (WP-8); docs/wp-notes/wp-9.md D-3.
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | {
      readonly kind: 'item';
      readonly id: string;
      readonly label: string;
      readonly onSelect: () => void;
      readonly testId?: string | undefined;
      readonly disabled?: boolean | undefined;
      /** Checkbox items show a tick; undefined: plain item. */
      readonly checked?: boolean | undefined;
      /** Tooltip, e.g. why the item is disabled. */
      readonly title?: string | undefined;
    }
  | { readonly kind: 'separator'; readonly id: string };

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

export interface ContextMenuHandle {
  /** The menu element to render (portal), or null when closed. */
  readonly element: JSX.Element | null;
  readonly isOpen: boolean;
  /** Opens at the pointer; `preventDefault` suppresses the browser menu. */
  open(
    event: { readonly clientX: number; readonly clientY: number; preventDefault(): void },
    label: string,
    entries: readonly MenuEntry[],
  ): void;
  close(): void;
}

export function useContextMenu(): ContextMenuHandle {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback<ContextMenuHandle['open']>((event, label, entries) => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, label, entries });
  }, []);
  const element = useMemo(
    () => (state === null ? null : <ContextMenu key={`${state.x},${state.y}`} state={state} onClose={close} />),
    [state, close],
  );
  return { element, isOpen: state !== null, open, close };
}

const ITEM_SELECTOR =
  '[role="menuitem"]:not([aria-disabled="true"]),[role="menuitemcheckbox"]:not([aria-disabled="true"])';

function ContextMenu(props: { readonly state: ContextMenuState; readonly onClose: () => void }): JSX.Element {
  const { state, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const returnFocus = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (menu === null) return;
    returnFocus.current = document.activeElement;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(state.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(state.y, window.innerHeight - rect.height - 4)),
    });
    menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [state.x, state.y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) !== true) onClose();
    };
    const dismiss = (): void => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, [onClose]);

  /** Keyboard dismissal and choices hand focus back to where the menu was opened from. */
  const closeAndRestoreFocus = (): void => {
    const previous = returnFocus.current;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    onClose();
  };

  const choose = (entry: Extract<MenuEntry, { kind: 'item' }>): void => {
    if (entry.disabled === true) return;
    closeAndRestoreFocus();
    entry.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number): void => items[(i + items.length) % items.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index < 0 ? -1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Escape':
      case 'Tab':
        closeAndRestoreFocus();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={state.label}
      tabIndex={-1}
      data-testid="data-panel-menu"
      className="fixed z-40 min-w-44 rounded-[6px] border border-line bg-[var(--bg-popover,#2c2e34)] py-1 text-xs text-fg shadow-[0_8px_24px_rgba(0,0,0,0.45)] select-none"
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.entries.map((entry) =>
        entry.kind === 'separator' ? (
          <hr key={entry.id} className="my-1 border-line" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled === true ? 'true' : undefined}
            tabIndex={-1}
            title={entry.title}
            data-testid={entry.testId}
            className={
              'flex h-6 w-full cursor-default items-center gap-2 px-2 text-left outline-none ' +
              (entry.disabled === true
                ? 'text-[var(--text-disabled,#5d616b)]'
                : 'hover:bg-[var(--bg-hover,#30323a)] focus:bg-[var(--bg-hover,#30323a)]')
            }
            onClick={() => choose(entry)}
          >
            <span className="w-3 text-center text-accent-text" aria-hidden="true">
              {entry.checked === true ? '✓' : ''}
            </span>
            {entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
