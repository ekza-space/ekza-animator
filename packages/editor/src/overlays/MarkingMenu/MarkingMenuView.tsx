// The marking menu's drawing (M6A-SPEC §5.18, §8.10 `mm-<menuId>`, `mm-slot-<N…NW>`, `mm-item-<n>`; B9): a lazy
// chunk, loaded when a menu first opens (it is drawn only after the 250 ms flick window). Eight compass slots around
// the centre and the list below; disabled items show their reason. No animation (`prefers-reduced-motion` or not).
import type { CompassSlot } from '@ekza-studio/editor-core';
import { cn } from '@ekza-studio/ui';
import type { CSSProperties, JSX } from 'react';
import {
  COMPASS,
  LIST_OFFSET,
  MM_RADIUS,
  type MarkingMenuController,
  type MarkingMenuEntry,
  type MarkingMenuTarget,
  menuLabel,
  type OpenMarkingMenu,
  slotPosition,
} from './controller';

/** Centres an element on its position (inline: the menu must place itself without the stylesheet). */
const CENTRED = 'translate(-50%, -50%)';

function sameTarget(a: MarkingMenuTarget | null, b: MarkingMenuTarget): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind === 'slot'
    ? b.kind === 'slot' && a.slot === b.slot
    : (a as { index: number }).index === (b as { index: number }).index;
}

function Item(props: {
  readonly controller: MarkingMenuController;
  readonly open: OpenMarkingMenu;
  readonly entry: MarkingMenuEntry;
  readonly target: MarkingMenuTarget;
  readonly testId: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}): JSX.Element {
  const { controller, open, entry, target } = props;
  const hovered = sameTarget(open.hover, target);
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={!entry.enabled}
      aria-haspopup={entry.submenu === null ? undefined : 'menu'}
      title={entry.reason ?? undefined}
      data-testid={props.testId}
      data-enabled={entry.enabled ? 'true' : 'false'}
      data-hover={hovered ? 'true' : undefined}
      className={cn(
        'pointer-events-auto flex h-6 items-center gap-1 whitespace-nowrap rounded-popover border border-line bg-popover px-2 text-ui text-fg shadow-popover',
        hovered && entry.enabled && 'border-accent bg-[var(--bg-pressed,#3a3d46)]',
        !entry.enabled && 'text-fg-3',
        props.className,
      )}
      style={props.style}
      onPointerEnter={() => controller.hover(target)}
      onPointerLeave={() => controller.hover(null)}
      onClick={() => controller.activate(target)}
    >
      {entry.checked ? <span aria-hidden="true">✓</span> : null}
      <span>{entry.label}</span>
      {entry.submenu === null ? null : <span aria-hidden="true">▸</span>}
    </button>
  );
}

/** The expanded submenu's spoken name: the label of the item that opened it. */
function submenuLabel(open: OpenMarkingMenu): string | undefined {
  const from = open.expanded?.from;
  if (from === undefined) return undefined;
  const entry = from.kind === 'slot' ? open.slots[from.slot] : from.kind === 'item' ? open.list[from.index] : undefined;
  return entry?.label;
}

export function MarkingMenuView(props: {
  readonly controller: MarkingMenuController;
  readonly open: OpenMarkingMenu;
}): JSX.Element {
  const { controller, open } = props;
  const listTop = open.y + MM_RADIUS + LIST_OFFSET;
  return (
    <div
      className="pointer-events-none z-(--z-marking) select-none"
      style={{ position: 'fixed', inset: 0 }}
      role="menu"
      aria-label={menuLabel(open.def.id)}
      data-testid={`mm-${open.def.id}`}
      data-ekza-marking-menu=""
    >
      <span
        className="h-2 w-2 rounded-full border border-line bg-popover"
        style={{ position: 'absolute', left: open.x, top: open.y, transform: CENTRED }}
        aria-hidden="true"
      />
      {COMPASS.map((slot: CompassSlot) => {
        const entry = open.slots[slot];
        if (entry === undefined) return null;
        const at = slotPosition(open.x, open.y, slot);
        return (
          <Item
            key={slot}
            controller={controller}
            open={open}
            entry={entry}
            target={{ kind: 'slot', slot }}
            testId={`mm-slot-${slot}`}
            style={{ position: 'absolute', left: at.x, top: at.y, transform: CENTRED }}
          />
        );
      })}
      {open.list.length === 0 ? null : (
        <div
          className="pointer-events-auto flex flex-col gap-0.5"
          style={{ position: 'absolute', left: open.x, top: listTop, transform: 'translateX(-50%)' }}
        >
          {open.list.map((entry, index) => (
            <Item
              key={`${index}:${entry.label}`}
              controller={controller}
              open={open}
              entry={entry}
              target={{ kind: 'item', index }}
              testId={`mm-item-${index}`}
            />
          ))}
        </div>
      )}
      {open.expanded === null ? null : (
        <div
          className="pointer-events-auto flex flex-col gap-0.5"
          style={{ position: 'absolute', left: open.x + MM_RADIUS + 70, top: open.y - MM_RADIUS }}
          role="menu"
          aria-label={submenuLabel(open)}
          data-testid={`mm-sub-${open.def.id}`}
        >
          {open.expanded.items.map((entry, index) => (
            <Item
              key={`${index}:${entry.label}`}
              controller={controller}
              open={open}
              entry={entry}
              target={{ kind: 'sub', index }}
              testId={`mm-sub-item-${index}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default MarkingMenuView;
