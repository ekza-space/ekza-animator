// The verb ring and verb bar (STUDIO-TOUCH-SPEC §4.1, §4.4, §6.1, §6.3, §18): up to six petals in plain words plus
// ⋯ More. The ring (the Halo) sits beside the selection, joined to it by a thin line, never over it; it becomes a
// row when the room beside is narrower than 240 px, or a compass ring around a point after a long-press. The bar is
// the same verbs docked in one row (phones, the Keys and Curves headers) with ⋯ pinned at its end; verbs that do not
// fit fold into it. A `menu` of `menuitem`s; disabled verbs stay visible and say why when tapped.
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn';
import { TOUCH } from './constants';
import { Glyph } from './glyphs';
import { arcLayout, type Box, COMPASS, type CompassSlot, fitRow, type Point, ringLayout, rovingIndex } from './layout';

export interface VerbItem {
  readonly id: string;
  /** Plain words (§3 P8): "Pull". */
  readonly label: string;
  /** The Pro name, read after the label ("Pull, Extrude"); shown in More, not on the petal. */
  readonly proName?: string;
  readonly icon?: ReactNode;
  /** The verb opens a submenu (▾). */
  readonly hasMenu?: boolean;
  /** The poll's reason: the petal stays visible and greyed; a tap shows the reason (§6.3). */
  readonly disabledReason?: string;
  /** The petal changed its verb in place (⟳ Again, Paste ▾): drawn with an outline. */
  readonly changed?: boolean;
  /** A toggle verb's state, drawn as a small switch. */
  readonly on?: boolean;
  /** Compass slot in the long-press ring (kept from the matching marking menu, §6.1). */
  readonly slot?: CompassSlot;
}

const petalClass = cn(
  'inline-flex min-h-(--touch-hit) select-none items-center gap-2 whitespace-nowrap rounded-full border border-line',
  'bg-panel py-0 pr-4 pl-3 font-medium text-fg shadow-touch transition-[background-color,opacity,transform]',
  'duration-(--motion-touch) hover:bg-hover active:bg-accent-fill active:text-on-accent',
  'aria-disabled:opacity-50 data-changed:shadow-[inset_0_0_0_2px_var(--warn),var(--elevation-touch)]',
);

export interface PetalProps {
  readonly verb: VerbItem;
  readonly onSelect: (id: string) => void;
  readonly onReason?: (id: string, reason: string) => void;
  readonly tabIndex?: number;
  readonly style?: CSSProperties;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly buttonRef?: (el: HTMLButtonElement | null) => void;
  readonly className?: string;
}

/** One verb: a 44 px pill with an icon and a word. */
export function Petal({
  verb,
  onSelect,
  onReason,
  tabIndex,
  style,
  onKeyDown,
  buttonRef,
  className,
}: PetalProps): JSX.Element {
  const disabled = verb.disabledReason !== undefined;
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      aria-label={verb.proName === undefined ? verb.label : `${verb.label}, ${verb.proName}`}
      aria-disabled={disabled || undefined}
      {...(verb.hasMenu === true ? { 'aria-haspopup': 'menu' as const } : {})}
      data-verb={verb.id}
      data-changed={verb.changed === true ? '' : undefined}
      tabIndex={tabIndex}
      style={style}
      className={cn(petalClass, className)}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (disabled) onReason?.(verb.id, verb.disabledReason ?? '');
        else onSelect(verb.id);
      }}
    >
      {verb.icon === undefined ? null : <span className="text-accent-text">{verb.icon}</span>}
      <span>{verb.label}</span>
      {verb.on === undefined ? null : (
        <span
          aria-hidden="true"
          className={cn('relative ml-0.5 h-[15px] w-[26px] rounded-full', verb.on ? 'bg-accent-fill' : 'bg-pressed')}
        >
          <span
            className={cn(
              'absolute top-0.5 left-0.5 size-[11px] rounded-full',
              verb.on ? 'translate-x-[11px] bg-on-accent' : 'bg-fg-3',
            )}
          />
        </span>
      )}
      {verb.hasMenu === true ? (
        <span className="-ml-1 text-fg-3">
          <Glyph name="down" size={16} />
        </span>
      ) : null}
    </button>
  );
}

const MORE: VerbItem = { id: 'more', label: 'More' };

function MorePetal({
  label,
  onMore,
  tabIndex,
  style,
  onKeyDown,
  buttonRef,
  className,
}: {
  readonly label: string;
  readonly onMore: () => void;
  readonly tabIndex?: number;
  readonly style?: CSSProperties;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly buttonRef?: (el: HTMLButtonElement | null) => void;
  readonly className?: string;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="menuitem"
      aria-haspopup="dialog"
      data-verb="more"
      tabIndex={tabIndex}
      style={style}
      className={cn(petalClass, 'bg-header text-fg-2', className)}
      onKeyDown={onKeyDown}
      onClick={onMore}
    >
      <Glyph name="more" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Compass slots for the long-press ring: a verb keeps its own slot (the matching marking menu's, §6.1), the others —
 * ⋯ More last — take the free slots in compass order, so no two petals share a direction.
 */
export function ringSlots(verbs: readonly Pick<VerbItem, 'slot'>[]): CompassSlot[] {
  const taken = new Set<CompassSlot>();
  for (const v of verbs) if (v.slot !== undefined) taken.add(v.slot);
  const free = COMPASS.filter((slot) => !taken.has(slot));
  let next = 0;
  return verbs.map((v) => v.slot ?? free[next++] ?? 'N');
}

/** Roving focus over a menu's buttons (arrows, Home / End) and Escape. */
function useRoving(count: number, orientation: 'horizontal' | 'both', onDismiss?: () => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss?.();
      return;
    }
    const next = rovingIndex(index, event.key, count, orientation);
    if (next === null) return;
    event.preventDefault();
    setFocus(next);
    refs.current[next]?.focus();
  };
  const ref = (index: number) => (el: HTMLButtonElement | null) => {
    refs.current[index] = el;
  };
  return { refs, focus: Math.min(focus, Math.max(0, count - 1)), onKeyDown, ref };
}

export interface VerbRingProps {
  readonly verbs: readonly VerbItem[];
  /** The menu's accessible name: the noun ("2 faces", "Right forearm"). */
  readonly label: string;
  readonly onSelect: (id: string) => void;
  readonly onMore: () => void;
  readonly onReason?: (id: string, reason: string) => void;
  readonly onDismiss?: () => void;
  /** `arc`: beside `target` (a tap); `ring`: compass slots around `center` (a long-press). */
  readonly mode?: 'arc' | 'ring';
  /** The selection's box in the container (arc mode). */
  readonly target?: Box;
  /** The press point (ring mode). */
  readonly center?: Point;
  /** The container the ring is positioned in (CSS px). */
  readonly width: number;
  readonly height: number;
  readonly prefer?: 'left' | 'right';
  readonly insetTop?: number;
  readonly insetBottom?: number;
  /** Hide ⋯ More (the reduced Halo beside Echo chips, §6.1). */
  readonly hideMore?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** The Halo: petals laid out by `arcLayout` / `ringLayout`, measured after the first paint. */
export function VerbRing({
  verbs,
  label,
  onSelect,
  onMore,
  onReason,
  onDismiss,
  mode = 'arc',
  target,
  center,
  width,
  height,
  prefer = 'left',
  insetTop,
  insetBottom,
  hideMore = false,
  autoFocus = false,
  className,
  'data-testid': testId,
}: VerbRingProps): JSX.Element {
  const shown = verbs.slice(0, TOUCH.maxPetals);
  const count = shown.length + (hideMore ? 0 : 1);
  const roving = useRoving(count, 'both', onDismiss);
  const [widths, setWidths] = useState<readonly number[] | null>(null);

  const ids = shown.map((v) => v.id).join(' ');

  // Petals render first at their natural width (hidden), then take their place; a label that changes width (a
  // petal that changed its verb, a late font) re-measures through the observer.
  useLayoutEffect(() => {
    const els = roving.refs.current.slice(0, count).filter((el): el is HTMLButtonElement => el !== null);
    const measure = (): void => {
      const next = els.map((el) => el.offsetWidth);
      setWidths((prev) =>
        prev !== null && prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    for (const el of els) ro.observe(el);
    return () => ro.disconnect();
  }, [count, ids, roving.refs]);

  let layout: {
    readonly positions: readonly Point[];
    readonly connector: { readonly from: Point; readonly to: Point } | null;
    readonly center: Point | null;
  } | null = null;
  if (widths !== null && widths.length === count) {
    if (mode === 'ring' && center !== undefined) {
      const slots = ringSlots([...shown, ...(hideMore ? [] : [MORE])]).map((slot, i) => ({
        slot,
        width: widths[i] ?? 0,
      }));
      const r = ringLayout(center, slots, width, height);
      layout = { positions: r.positions, connector: null, center: r.center };
    } else if (target !== undefined) {
      const a = arcLayout({
        target,
        widths,
        width,
        height,
        prefer,
        ...(insetTop === undefined ? {} : { insetTop }),
        ...(insetBottom === undefined ? {} : { insetBottom }),
      });
      layout = { positions: a.positions, connector: a.connector, center: null };
    }
  }
  const placed = layout !== null;

  useLayoutEffect(() => {
    if (autoFocus && placed) roving.refs.current[0]?.focus({ preventScroll: true });
  }, [autoFocus, placed, roving.refs]);

  const place = (i: number): CSSProperties => {
    const p = layout?.positions[i];
    return p === undefined
      ? { position: 'absolute', left: 0, top: 0, visibility: 'hidden' }
      : { position: 'absolute', left: p.x, top: p.y, transitionDelay: `${i * 18}ms` };
  };

  return (
    <div
      role="menu"
      aria-label={label}
      data-testid={testId}
      data-mode={mode}
      className={cn('pointer-events-none absolute inset-0', className)}
    >
      {layout === null || layout.connector === null ? null : (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <path
            d={`M${layout.connector.from.x} ${layout.connector.from.y} Q ${(layout.connector.from.x + layout.connector.to.x) / 2} ${layout.connector.from.y} ${layout.connector.to.x} ${layout.connector.to.y}`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            opacity={0.6}
          />
          <circle cx={layout.connector.from.x} cy={layout.connector.from.y} r={3.5} fill="var(--accent)" />
        </svg>
      )}
      {layout === null || layout.center === null ? null : (
        <span
          aria-hidden="true"
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_6px_var(--accent-soft)]"
          style={{ left: layout.center.x, top: layout.center.y }}
        />
      )}
      {shown.map((verb, i) => (
        <Petal
          key={verb.id}
          verb={verb}
          onSelect={onSelect}
          {...(onReason === undefined ? {} : { onReason })}
          tabIndex={i === roving.focus ? 0 : -1}
          style={place(i)}
          onKeyDown={roving.onKeyDown(i)}
          buttonRef={roving.ref(i)}
          className="pointer-events-auto"
        />
      ))}
      {hideMore ? null : (
        <MorePetal
          label={MORE.label}
          onMore={onMore}
          tabIndex={shown.length === roving.focus ? 0 : -1}
          style={place(shown.length)}
          onKeyDown={roving.onKeyDown(shown.length)}
          buttonRef={roving.ref(shown.length)}
          className="pointer-events-auto"
        />
      )}
    </div>
  );
}

export interface VerbBarProps {
  readonly verbs: readonly VerbItem[];
  readonly label: string;
  readonly onSelect: (id: string) => void;
  /** ⋯ More; receives the ids that folded into it. */
  readonly onMore: (folded: readonly string[]) => void;
  readonly onReason?: (id: string, reason: string) => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** The Halo docked as one row with ⋯ pinned at the end (phones; the Keys and Curves layer headers). */
export function VerbBar({
  verbs,
  label,
  onSelect,
  onMore,
  onReason,
  className,
  'data-testid': testId,
}: VerbBarProps): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [natural, setNatural] = useState<{ readonly widths: readonly number[]; readonly more: number } | null>(null);
  const visible = natural === null || rowWidth === 0 ? verbs.length : fitRow(natural.widths, rowWidth, natural.more, 6);
  const shown = verbs.slice(0, visible);
  const folded = verbs.slice(visible).map((v) => v.id);
  const roving = useRoving(shown.length + 1, 'horizontal');

  const ids = verbs.map((v) => `${v.id}:${v.label}`).join(',');

  // The row's width and every petal's natural width (an invisible copy), kept current by one observer.
  useLayoutEffect(() => {
    const el = row.current;
    const probe = measure.current;
    if (el === null || probe === null) return;
    const read = (): void => {
      const items = [...probe.children] as HTMLElement[];
      const next = {
        widths: items.slice(0, -1).map((c) => c.offsetWidth),
        more: items.at(-1)?.offsetWidth ?? TOUCH.hit,
      };
      setRowWidth(el.clientWidth);
      setNatural((prev) =>
        prev !== null &&
        prev.more === next.more &&
        prev.widths.length === next.widths.length &&
        prev.widths.every((w, i) => w === next.widths[i])
          ? prev
          : next,
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    for (const child of probe.children) ro.observe(child);
    return () => ro.disconnect();
  }, [ids]);

  return (
    <div ref={row} className={cn('relative min-w-0', className)}>
      {/* An invisible copy measures every petal at its natural width. */}
      <div ref={measure} aria-hidden="true" className="pointer-events-none invisible absolute flex gap-1.5" inert>
        {verbs.map((v) => (
          <Petal key={v.id} verb={v} onSelect={() => undefined} tabIndex={-1} />
        ))}
        <MorePetal label="More (9)" onMore={() => undefined} tabIndex={-1} />
      </div>
      <div
        role="menu"
        aria-label={label}
        aria-orientation="horizontal"
        data-testid={testId}
        className="flex items-center gap-1.5"
      >
        {shown.map((verb, i) => (
          <Petal
            key={verb.id}
            verb={verb}
            onSelect={onSelect}
            {...(onReason === undefined ? {} : { onReason })}
            tabIndex={i === roving.focus ? 0 : -1}
            onKeyDown={roving.onKeyDown(i)}
            buttonRef={roving.ref(i)}
          />
        ))}
        <span className="ml-auto" />
        <MorePetal
          label={folded.length > 0 ? `More (${folded.length})` : 'More'}
          onMore={() => onMore(folded)}
          tabIndex={shown.length === roving.focus ? 0 : -1}
          onKeyDown={roving.onKeyDown(shown.length)}
          buttonRef={roving.ref(shown.length)}
        />
      </div>
    </div>
  );
}
