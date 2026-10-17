// A small dropdown menu for pane headers (button + menu list). Plain DOM until the ui package ships its Radix
// DropdownMenu (WP-8); keyboard: Enter/Space/ArrowDown open, arrows move, Escape closes.
import { type JSX, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface PaneMenuItem {
  readonly id: string;
  readonly label: string;
  /** An on/off item (`menuitemcheckbox`, ✓) instead of one choice among several (`menuitemradio`, •). */
  readonly checkbox?: boolean;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}

const ITEM = '[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled])';

export function PaneMenu(props: {
  readonly label: ReactNode;
  readonly title: string;
  readonly testId: string;
  readonly items: readonly PaneMenuItem[];
  /** Which edge of the button the menu lines up with (default left). */
  readonly align?: 'left' | 'right';
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>(ITEM)?.focus();
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>(ITEM) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-fg hover:bg-[var(--bg-hover,#30323a)]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={props.title}
        data-testid={props.testId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {props.label}
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1 2.5 4 5.5 7 2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          className={`absolute ${props.align === 'right' ? 'right-0' : 'left-0'} top-6 z-40 min-w-44 rounded-md border border-line bg-[var(--bg-popover,#2c2e34)] py-1 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]`}
          onKeyDown={onMenuKey}
        >
          {props.items.map((item) => (
            <div key={item.id}>
              {item.separatorBefore === true ? <hr className="my-1 border-line" /> : null}
              <button
                type="button"
                role={item.checkbox === true ? 'menuitemcheckbox' : 'menuitemradio'}
                aria-checked={item.checked === true}
                disabled={item.disabled === true}
                className="flex w-full items-center gap-2 px-3 py-1 text-left text-fg hover:bg-[var(--bg-hover,#30323a)] focus:bg-[var(--bg-hover,#30323a)] focus:outline-none disabled:text-[var(--text-disabled,#5d616b)]"
                data-testid={`${props.testId}-${item.id}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span className="w-3 text-accent-text" aria-hidden="true">
                  {item.checked === true ? (item.checkbox === true ? '✓' : '•') : ''}
                </span>
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
