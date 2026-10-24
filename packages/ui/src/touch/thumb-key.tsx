// The Thumb key (STUDIO-TOUCH-SPEC §5.5, §18): one 56 px key in the off-hand corner. Its two lines say what the next
// tap and the next drag will do (`⊕ select more` / `≈ fine`); tap = next action only, double-tap = lock, hold =
// while held, slide up = the chooser. A toggle button whose accessible name is its current meaning. The caller
// owns the state (`useThumbKey`) so the canvas can `consume` a once-meaning and a lock can mirror a tray chip
// (§5.5 "one state"); the caller also hides the key when neither line would change the next tap or drag.
import { type Dispatch, type JSX, type PointerEvent as ReactPointerEvent, useReducer, useRef } from 'react';
import { cn } from '../cn';
import { Glyph } from './glyphs';
import { boxAt } from './layout';
import { THUMB_INITIAL, type ThumbEvent, type ThumbState, thumbReduce } from './thumb-model';

export interface ThumbMeaning {
  /** One glyph per meaning (⊕ ⊙ ⊖ ≈ ✦ ◌ …), shape not colour. */
  readonly glyph: string;
  /** Plain words: "select more", "fine". */
  readonly label: string;
}

export interface ThumbChoice extends ThumbMeaning {
  readonly id: string;
  /** The Pro equivalent, shown in grey ("Shift + click"). */
  readonly proName?: string;
  readonly on?: boolean;
}

export function useThumbKey(): [ThumbState, Dispatch<ThumbEvent>] {
  return useReducer(thumbReduce, THUMB_INITIAL);
}

/** The accessible name: the meaning and how long it lasts (§18). */
export function thumbKeyName(state: ThumbState, tap?: ThumbMeaning, drag?: ThumbMeaning): string {
  const what = [tap?.label, drag?.label].filter((s): s is string => s !== undefined).join(' and ') || 'Modifier';
  const name = what.charAt(0).toUpperCase() + what.slice(1);
  const scope = tap !== undefined && drag !== undefined ? 'tap or drag' : tap !== undefined ? 'tap' : 'drag';
  switch (state.latch) {
    case 'once':
      return `${name}, for the next ${scope}`;
    case 'locked':
      return `${name}, locked on`;
    case 'held':
      return `${name}, while held`;
    case 'off':
      return name;
  }
}

export interface ThumbKeyProps {
  readonly state: ThumbState;
  readonly dispatch: Dispatch<ThumbEvent>;
  /** What the next tap does with the key on. */
  readonly tap?: ThumbMeaning;
  /** What the next drag does with the key on. */
  readonly drag?: ThumbMeaning;
  /** The other meanings that apply here (slide up). */
  readonly choices?: readonly ThumbChoice[];
  readonly onChoose?: (id: string) => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const SLIDE_UP_PX = 24;

export function ThumbKey({
  state,
  dispatch,
  tap,
  drag,
  choices = [],
  onChoose,
  className,
  'data-testid': testId,
}: ThumbKeyProps): JSX.Element {
  const press = useRef<{ id: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const active = state.latch !== 'off';

  const choiceUnder = (event: ReactPointerEvent): string | null => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-choice]') ?? [])];
    const boxes = items.map((el) => el.getBoundingClientRect());
    const i = boxAt({ x: event.clientX, y: event.clientY }, boxes);
    return i < 0 ? null : (items[i]?.dataset.choice ?? null);
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      {state.chooser && choices.length > 0 ? (
        <div
          ref={list}
          role="menu"
          aria-label="Other meanings"
          className="absolute bottom-[calc(100%+10px)] left-0 z-(--z-popover) flex min-w-[200px] flex-col gap-1.5 rounded-touch-card border border-line bg-panel p-1.5 shadow-sheet"
        >
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={c.on === true}
              data-choice={c.id}
              className="flex min-h-(--touch-hit) items-center justify-between gap-4 rounded-touch-inner px-3 text-left font-medium aria-checked:bg-accent-soft"
              onClick={() => {
                onChoose?.(c.id);
                dispatch({ type: 'closeChooser' });
              }}
            >
              <span>
                <span aria-hidden="true" className="mr-1.5 inline-block w-[1.2em] text-center font-bold">
                  {c.glyph}
                </span>
                {c.label}
              </span>
              {c.proName === undefined ? null : (
                <span className="text-touch-label font-normal text-fg-3">{c.proName}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        aria-pressed={active}
        aria-label={thumbKeyName(state, tap, drag)}
        data-latch={state.latch}
        data-testid={testId}
        className={cn(
          'relative inline-flex min-h-(--touch-key) min-w-[120px] touch-none select-none items-center gap-2.5 rounded-full',
          'border border-line bg-touch-surface py-1 pr-[18px] pl-2.5 text-touch font-semibold text-fg shadow-touch',
          'backdrop-blur-md transition-colors duration-(--motion-hover)',
          'aria-pressed:border-transparent aria-pressed:bg-accent-fill aria-pressed:text-on-accent',
        )}
        onPointerDown={(event) => {
          if (event.button !== 0 || press.current !== null) return;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // without capture the key still works while the thumb stays on it
          }
          press.current = { id: event.pointerId, y: event.clientY };
          dispatch({ type: 'press', time: event.timeStamp });
        }}
        onPointerMove={(event) => {
          const p = press.current;
          if (p === null || p.id !== event.pointerId) return;
          if (!state.chooser && choices.length > 0 && p.y - event.clientY > SLIDE_UP_PX) dispatch({ type: 'slideUp' });
        }}
        onPointerUp={(event) => {
          const p = press.current;
          if (p === null || p.id !== event.pointerId) return;
          press.current = null;
          if (state.chooser) {
            const id = choiceUnder(event);
            if (id !== null) {
              onChoose?.(id);
              dispatch({ type: 'closeChooser' });
            }
          }
          dispatch({ type: 'release', time: event.timeStamp });
        }}
        onPointerCancel={() => {
          press.current = null;
          dispatch({ type: 'cancel' });
        }}
        onClick={(event) => {
          // Keyboard and assistive technology activate without pointer events (detail 0): a tap.
          if (event.detail === 0) dispatch({ type: 'key', time: event.timeStamp });
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-[30px] shrink-0 items-center justify-center rounded-full',
            active ? 'bg-white/20' : 'bg-accent-soft text-accent-text',
          )}
        >
          <Glyph name={state.latch === 'locked' ? 'lock' : 'shift'} size={18} />
        </span>
        <span aria-hidden="true" className="flex flex-col text-left leading-[1.15]">
          {tap === undefined ? null : (
            <span className="text-[14px] whitespace-nowrap">
              <span className="mr-[3px] inline-block w-[1.2em] text-center font-bold">{tap.glyph}</span>
              {tap.label}
            </span>
          )}
          {drag === undefined ? null : (
            <span
              className={cn('text-[13px] font-medium whitespace-nowrap', !active && tap !== undefined && 'text-fg-2')}
            >
              <span className="mr-[3px] inline-block w-[1.2em] text-center font-bold">{drag.glyph}</span>
              {drag.label}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
