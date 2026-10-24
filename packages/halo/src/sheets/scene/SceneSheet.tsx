// The Scene sheet (STUDIO-TOUCH-SPEC §6.5, §15 rows 1.10, 5.16, §18; T6b): the Outliner as a list at touch density over
// `./model`. Tap a row to select it (a character row makes it the active character); its eye shows or hides it; hold
// a row for its menu, or hold, lift and drop it on another row to parent it there (`./lift`, pointer events with
// capture; the list keeps `touch-action: pan-y` so a press that moves first scrolls); ⋯ is the menu's visible twin,
// with Rename and *Parent to…*. Sections: Objects, Characters, References, Cameras, Reparent, Visibility.
import { ActionChip, Glyph, SheetGroup, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import {
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { HaloSheetContext, HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet, useAppVersion } from '../more/kit';
import { createLiftRecognizer, type LiftEvent } from './lift';
import {
  dropCall,
  type OperatorCall,
  type ParentTarget,
  type SceneAction,
  type SceneModel,
  type SceneRow,
  type SceneSectionId,
  sceneModel,
} from './model';

const SECTION_TITLE: Readonly<Record<SceneSectionId, string>> = {
  objects: 'Objects',
  characters: 'Characters',
  references: 'Reference images',
  cameras: 'Shot cameras',
  reparent: 'Parent',
  visibility: 'Show and hide',
};

/** Runs calls in order; stops at the first that does not finish (its toast says why). */
async function runCalls(ctx: HaloSheetContext, calls: readonly OperatorCall[]): Promise<boolean> {
  for (const call of calls) {
    const result = await ctx.run(call.op, call.args);
    if (result.status !== 'finished') return false;
  }
  return true;
}

/** Re-renders when a character's runtime loads (the Outliner lists its imported meshes from the container). */
function useCharactersVersion(ctx: HaloSheetContext): number {
  const app = ctx.host.app;
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) =>
      app.characters.subscribe(() => {
        version.current += 1;
        notify();
      }),
    [app],
  );
  return useSyncExternalStore(
    subscribe,
    () => version.current,
    () => version.current,
  );
}

function EyeIcon(props: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      {props.open ? <circle cx="12" cy="12" r="3" /> : <path d="M4 4l16 16" />}
    </svg>
  );
}

/** The row under a client point (`data-scene-row`), or null. */
function rowAt(x: number, y: number): string | null {
  if (typeof document === 'undefined') return null;
  const element = document.elementFromPoint(x, y);
  return element?.closest('[data-scene-row]')?.getAttribute('data-scene-row') ?? null;
}

interface MenuState {
  readonly key: string;
  readonly mode: 'actions' | 'rename' | 'parent';
}

interface LiftState {
  readonly key: string;
  readonly over: string | null;
}

interface LiftHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(): void;
  /** A right-click is the row menu; a touch long-press's own `contextmenu` is left to the recogniser. */
  onContextMenu(event: ReactMouseEvent<HTMLElement>): void;
}

/**
 * The lift-and-drop recogniser wired to pointer events (one press at a time); a row's button carries its key in
 * `data-scene-key`. `lifted()` is read by the list's touchmove listener (never during render).
 */
function useLift(onEvent: (event: LiftEvent) => void): {
  readonly handlers: LiftHandlers;
  readonly lifted: () => boolean;
} {
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  const [lift] = useState(() => {
    const recognizer = createLiftRecognizer();
    let pointer: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const emit = (events: readonly LiftEvent[]): void => {
      for (const event of events) latest.current(event);
    };
    const clear = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const arm = (): void => {
      clear();
      const due = recognizer.deadline;
      if (due === null) return;
      timer = setTimeout(
        () => {
          timer = null;
          emit(recognizer.tick(performance.now()));
        },
        Math.max(0, due - performance.now()),
      );
    };
    const handlers: LiftHandlers = {
      onPointerDown(event) {
        const key = event.currentTarget.getAttribute('data-scene-key');
        if (key === null || event.button !== 0 || pointer !== null) return;
        pointer = event.pointerId;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // a synthetic or already released pointer: the press still works without capture
        }
        emit(recognizer.down(key, event.clientX, event.clientY, event.timeStamp, event.pointerType));
        arm();
      },
      onPointerMove(event) {
        if (pointer !== event.pointerId) return;
        emit(recognizer.move(event.clientX, event.clientY, event.timeStamp, rowAt(event.clientX, event.clientY)));
        if (recognizer.phase !== 'pressed') clear();
      },
      onPointerUp(event) {
        if (pointer !== event.pointerId) return;
        pointer = null;
        clear();
        emit(recognizer.up(event.clientX, event.clientY, event.timeStamp, rowAt(event.clientX, event.clientY)));
      },
      onPointerCancel() {
        pointer = null;
        clear();
        emit(recognizer.cancel());
      },
      onContextMenu(event) {
        event.preventDefault();
        const key = event.currentTarget.getAttribute('data-scene-key');
        if (key !== null && pointer === null) emit([{ kind: 'menu', key }]);
      },
    };
    return {
      handlers,
      lifted: () => recognizer.phase === 'lifted' || recognizer.phase === 'dragging',
      dispose: clear,
    };
  });
  useEffect(() => lift.dispose, [lift]);
  return lift;
}

function ActionButton(props: {
  readonly action: SceneAction;
  readonly onRun: (action: SceneAction) => void;
  readonly testId: string;
  readonly label?: ReactNode;
}): JSX.Element {
  const { action } = props;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <ActionChip
        disabled={!action.enabled}
        onClick={() => props.onRun(action)}
        data-testid={props.testId}
        title={action.reason ?? undefined}
      >
        {props.label ?? action.label}
      </ActionChip>
      {action.reason === null ? null : <span className="px-1 text-touch-label text-fg-3">{action.reason}</span>}
    </span>
  );
}

/** *Replace image…* on a reference image's row (T6-INT): Files (or Photos on iPad), then one `imagePlane.replace`. */
function ReplaceImage(props: { readonly onPicked: (bytes: Uint8Array, name: string) => void }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <ActionChip onClick={() => input.current?.click()} data-testid="halo-scene-menu-replace">
        Replace image…
      </ActionChip>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid="halo-scene-replace-file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined)
            void file.arrayBuffer().then((buffer) => props.onPicked(new Uint8Array(buffer), file.name));
        }}
      />
    </>
  );
}

function RowMenu(props: {
  readonly row: SceneRow;
  readonly mode: MenuState['mode'];
  readonly setMode: (mode: MenuState['mode']) => void;
  readonly onRun: (action: SceneAction) => void;
  readonly onCall: (call: OperatorCall) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const { row } = props;
  const [name, setName] = useState(row.name);
  const field = useRef<HTMLInputElement>(null);
  // the field opens on an explicit Rename tap: focus it then (not on mount of the sheet)
  useEffect(() => {
    if (props.mode === 'rename') field.current?.focus();
  }, [props.mode]);
  if (props.mode === 'rename' && row.rename !== null) {
    const rename = row.rename;
    const save = (): void => {
      if (name.trim() !== '' && name !== row.name) props.onCall(rename(name.trim()));
      props.onClose();
    };
    return (
      <form
        className="flex flex-wrap items-center gap-2 px-2.5 pb-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          ref={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={`New name for ${row.name}`}
          data-testid="halo-scene-rename-input"
          className="min-h-(--touch-hit) min-w-0 flex-1 rounded-touch border border-line bg-field px-3 text-[16px] text-fg"
        />
        <TouchButton type="submit" variant="primary" data-testid="halo-scene-rename-save">
          Rename
        </TouchButton>
        <TouchButton variant="ghost" onClick={props.onClose} data-testid="halo-scene-rename-cancel">
          Cancel
        </TouchButton>
      </form>
    );
  }
  if (props.mode === 'parent') {
    return (
      <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0 pb-2 pl-4">
        <legend className="sr-only">{`Parent ${row.name} to`}</legend>
        <span className="px-2.5 text-touch-label text-fg-3">Parent to… · Studio Pro: Parent</span>
        {row.parentTargets.map((target: ParentTarget) => (
          <button
            key={target.key}
            type="button"
            className="flex min-h-[52px] items-center rounded-touch px-2.5 text-left font-medium text-fg active:bg-header"
            onClick={() => {
              props.onCall(target.call);
              props.onClose();
            }}
            data-testid={`halo-scene-parent-${target.key}`}
          >
            {target.name}
          </button>
        ))}
        <TouchButton variant="ghost" onClick={() => props.setMode('actions')} data-testid="halo-scene-parent-back">
          ‹ Back
        </TouchButton>
      </fieldset>
    );
  }
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0 px-2.5 pb-2">
      <legend className="sr-only">{`${row.name}: more`}</legend>
      {row.menu.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          onRun={(chosen) => {
            props.onRun(chosen);
            props.onClose();
          }}
          testId={`halo-scene-menu-${action.id}`}
        />
      ))}
      {row.rename === null ? null : (
        <ActionChip onClick={() => props.setMode('rename')} data-testid="halo-scene-menu-rename">
          Rename…
        </ActionChip>
      )}
      {row.replaceImage === undefined ? null : (
        <ReplaceImage
          onPicked={(bytes, fileName) => {
            const replace = row.replaceImage;
            if (replace !== undefined) props.onCall(replace(bytes, fileName));
            props.onClose();
          }}
        />
      )}
      {row.parentTargets.length === 0 ? null : (
        <ActionChip onClick={() => props.setMode('parent')} data-testid="halo-scene-menu-parent">
          Parent to…
        </ActionChip>
      )}
    </fieldset>
  );
}

function Row(props: {
  readonly row: SceneRow;
  readonly lift: LiftState | null;
  readonly dropOk: boolean;
  readonly menu: MenuState | null;
  readonly handlers: LiftHandlers;
  readonly onToggle: (row: SceneRow) => void;
  readonly onSelect: (row: SceneRow) => void;
  readonly onRun: (action: SceneAction) => void;
  readonly onCall: (call: OperatorCall) => void;
  readonly setMenu: (menu: MenuState | null) => void;
}): JSX.Element {
  const { row, lift } = props;
  const lifted = lift?.key === row.key;
  const over = lift !== null && lift.over === row.key && !lifted;
  const open = props.menu?.key === row.key;
  return (
    <li data-scene-row={row.key} data-kind={row.kind}>
      <div
        className={[
          'flex items-center gap-1 rounded-touch',
          lifted ? 'bg-pressed shadow-touch' : '',
          over ? (props.dropOk ? 'outline-2 outline-accent' : 'outline-2 outline-danger/60') : '',
          row.selected ? 'bg-accent-soft' : '',
        ].join(' ')}
        style={{ paddingLeft: row.depth * 16 }}
        data-lifted={lifted ? '' : undefined}
        data-drop={over ? (props.dropOk ? 'ok' : 'no') : undefined}
      >
        {row.expandable ? (
          <TouchIconButton
            label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
            icon={<span aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>}
            className="border-transparent bg-transparent shadow-none"
            aria-expanded={row.expanded}
            onClick={() => props.onToggle(row)}
            data-testid={`halo-scene-expand-${row.key}`}
          />
        ) : (
          <span aria-hidden="true" className="inline-block w-(--touch-hit) shrink-0" />
        )}
        <button
          type="button"
          className="flex min-h-[52px] min-w-0 flex-1 select-none flex-col justify-center rounded-touch px-1.5 py-1.5 text-left active:bg-header"
          style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none' }}
          aria-current={row.active ? 'true' : undefined}
          aria-pressed={row.select === null ? undefined : row.selected}
          data-scene-key={row.key}
          {...props.handlers}
          onClick={(event) => {
            // pointer presses go through the recogniser; a keyboard or assistive activation (detail 0) is a tap
            if (event.detail === 0) props.onSelect(row);
          }}
          data-testid={`halo-scene-row-${row.key}`}
        >
          <span className={row.hidden ? 'truncate font-medium text-fg-3' : 'truncate font-medium text-fg'}>
            {row.active ? '● ' : ''}
            {row.name}
          </span>
          {row.detail === null ? null : <span className="truncate text-touch-label text-fg-3">{row.detail}</span>}
          {row.select !== null && row.select.reason !== null ? (
            <span className="truncate text-touch-label text-fg-2">{row.select.reason}</span>
          ) : null}
        </button>
        {row.eye === null ? null : (
          <TouchIconButton
            label={`${row.eye.label}: ${row.name}`}
            icon={<EyeIcon open={!row.hidden} />}
            className="border-transparent bg-transparent shadow-none"
            disabled={!row.eye.enabled}
            title={row.eye.reason ?? undefined}
            onClick={() => props.onRun(row.eye as SceneAction)}
            data-testid={`halo-scene-eye-${row.key}`}
          />
        )}
        {row.menu.length === 0 && row.rename === null && row.parentTargets.length === 0 ? null : (
          <TouchIconButton
            label={`More for ${row.name}`}
            icon={<Glyph name="more" />}
            className="border-transparent bg-transparent shadow-none"
            aria-expanded={open}
            onClick={() => props.setMenu(open ? null : { key: row.key, mode: 'actions' })}
            data-testid={`halo-scene-more-${row.key}`}
          />
        )}
      </div>
      {open && props.menu !== null ? (
        <RowMenu
          row={row}
          mode={props.menu.mode}
          setMode={(mode) => props.setMenu({ key: row.key, mode })}
          onRun={props.onRun}
          onCall={props.onCall}
          onClose={() => props.setMenu(null)}
        />
      ) : null}
    </li>
  );
}

function Section(props: {
  readonly id: SceneSectionId;
  readonly children: ReactNode;
  readonly hint?: ReactNode;
}): JSX.Element {
  return (
    <section
      data-section={props.id}
      aria-label={SECTION_TITLE[props.id]}
      data-testid={`halo-scene-section-${props.id}`}
    >
      <SheetGroup>{SECTION_TITLE[props.id]}</SheetGroup>
      {props.hint === undefined ? null : <p className="px-2.5 pb-1 text-touch-label text-fg-3">{props.hint}</p>}
      {props.children}
    </section>
  );
}

function RowList({
  rows,
  label,
  empty,
  children,
  attach,
}: {
  readonly rows: readonly SceneRow[];
  readonly label: string;
  readonly empty: string;
  readonly children: ReactNode;
  /** A callback ref for the list element. */
  readonly attach?: (element: HTMLUListElement | null) => void;
}): JSX.Element {
  if (rows.length === 0) return <p className="px-2.5 py-2 text-fg-3">{empty}</p>;
  return (
    <ul aria-label={label} ref={attach} className="m-0 list-none p-0" style={{ touchAction: 'pan-y' }}>
      {children}
    </ul>
  );
}

export default function SceneSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  useCharactersVersion(ctx);
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [lift, setLift] = useState<LiftState | null>(null);
  const [announce, setAnnounce] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const model: SceneModel = sceneModel(app, { expanded });

  const run = (action: SceneAction): void => {
    if (!action.enabled) return;
    void runCalls(ctx, action.calls);
  };
  const call = (one: OperatorCall): void => {
    void runCalls(ctx, [one]);
  };
  const select = (row: SceneRow): void => {
    if (row.select === null) setMenu({ key: row.key, mode: 'actions' });
    else run(row.select);
  };

  // The recogniser keeps the latest callback (updated after each render), so `model` is the rendered one.
  const { handlers, lifted } = useLift((event) => {
    const current = model;
    const row = current.rows.get(event.key);
    switch (event.kind) {
      case 'tap':
        if (row !== undefined) select(row);
        return;
      case 'menu':
        setLift(null);
        setMenu({ key: event.key, mode: 'actions' });
        return;
      case 'lift':
        setMenu(null);
        setLift({ key: event.key, over: null });
        setAnnounce(
          row === undefined || row.parentTargets.length === 0
            ? `${row?.name ?? 'This row'} cannot move. Lift your finger for its menu.`
            : `Lifted ${row.name}. Drop it on another row to parent it there.`,
        );
        return;
      case 'hover':
        setLift({ key: event.key, over: event.over });
        return;
      case 'drop': {
        setLift(null);
        const drop = dropCall(current, event.key, event.over);
        const target = current.rows.get(event.over);
        if (drop === null) {
          setAnnounce(`${row?.name ?? 'It'} cannot go under ${target?.name ?? 'that row'}.`);
          return;
        }
        setAnnounce(`Moved ${row?.name ?? ''} under ${target?.name ?? 'the top level'}.`);
        call(drop);
        return;
      }
      case 'cancel':
        setLift(null);
        return;
    }
  });

  // While a row is lifted the list must not scroll: a non-passive touchmove that prevents the pan, so the pointer
  // stream continues (React's touch listeners are passive).
  const attachList = useCallback(
    (element: HTMLUListElement | null) => {
      if (element === null) return undefined;
      const onTouchMove = (event: TouchEvent): void => {
        if (lifted()) event.preventDefault();
      };
      element.addEventListener('touchmove', onTouchMove, { passive: false });
      return () => element.removeEventListener('touchmove', onTouchMove);
    },
    [lifted],
  );

  // Open on a section (`args.section`): scroll it into view once.
  const section = args?.section;
  useEffect(() => {
    if (section === undefined) return;
    const element = body.current?.querySelector(`[data-section="${section}"]`);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'start' });
  }, [section]);

  const toggle = (row: SceneRow): void => setExpanded((current) => new Map(current).set(row.key, !row.expanded));
  // What every row shares (the lifted row, the open menu, the recogniser's handlers, the runs).
  const shared = {
    lift,
    dropOk: lift !== null && lift.over !== null && dropCall(model, lift.key, lift.over) !== null,
    menu,
    handlers,
    onToggle: toggle,
    onSelect: select,
    onRun: run,
    onCall: call,
    setMenu,
  };
  const { reparent, visibility } = model;

  return (
    <HaloSheet
      ctx={ctx}
      id="scene"
      title="Scene"
      description="Tap to select · hold and drag onto another row to parent · ⋯ for more"
    >
      <div ref={body} className="flex flex-col gap-1">
        <p className="sr-only" aria-live="polite" data-testid="halo-scene-announce">
          {announce}
        </p>
        <Section id="objects">
          <RowList
            rows={model.objects}
            label="Objects"
            empty="The scene is empty. Add a shape in Make, or bring a model from Home."
            attach={attachList}
          >
            {model.objects.map((row) => (
              <Row key={row.key} row={row} {...shared} />
            ))}
          </RowList>
        </Section>

        <Section id="characters" hint={model.characters.length > 1 ? 'Tap a character to work on it.' : undefined}>
          {model.characters.length === 0 ? (
            <p className="px-2.5 py-2 text-fg-3">No characters yet. In Rig, Make a character from your model.</p>
          ) : (
            model.characters.map((entry) => (
              <div key={entry.key} className="flex flex-col gap-1 pb-2">
                <button
                  type="button"
                  className="flex min-h-[52px] flex-col justify-center rounded-touch px-2.5 py-1.5 text-left active:bg-header aria-disabled:cursor-default"
                  aria-current={entry.active ? 'true' : undefined}
                  aria-disabled={!entry.select.enabled || undefined}
                  onClick={() => run(entry.select)}
                  data-testid={`halo-scene-character-${entry.id}`}
                >
                  <span className="font-medium text-fg">
                    {entry.active ? '● ' : ''}
                    {entry.name}
                  </span>
                  <span className="truncate text-touch-label text-fg-3">{entry.select.reason ?? entry.detail}</span>
                </button>
                <div className="flex flex-wrap gap-2 px-2.5">
                  <ActionButton action={entry.allControls} onRun={run} testId={`halo-scene-all-controls-${entry.id}`} />
                  {entry.allJoints === null ? null : (
                    <ActionButton action={entry.allJoints} onRun={run} testId={`halo-scene-all-joints-${entry.id}`} />
                  )}
                </div>
              </div>
            ))
          )}
        </Section>

        <Section id="references">
          <RowList rows={model.references} label="Reference images" empty="No reference images.">
            {model.references.map((row) => (
              <Row key={row.key} row={row} {...shared} />
            ))}
          </RowList>
        </Section>

        <Section id="cameras">
          <RowList
            rows={model.cameras}
            label="Shot cameras"
            empty="No shot cameras. View › Cameras adds one from the view."
          >
            {model.cameras.map((row) => (
              <Row key={row.key} row={row} {...shared} />
            ))}
          </RowList>
        </Section>

        <Section id="reparent" hint="Or hold a row, lift it and drop it on another.">
          {reparent.ids.length === 0 ? null : (
            <p className="px-2.5 pb-1 text-fg-2" data-testid="halo-scene-reparent-selection">
              {reparent.names.join(', ')}
            </p>
          )}
          {reparent.targets.length === 0 ? null : (
            <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0">
              <legend className="sr-only">Parent the selection to</legend>
              <span className="px-2.5 text-touch-label text-fg-3">Parent to… · Studio Pro: Parent</span>
              {reparent.targets.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  className="flex min-h-[52px] items-center rounded-touch px-2.5 text-left font-medium text-fg active:bg-header"
                  onClick={() => call(target.call)}
                  data-testid={`halo-scene-reparent-${target.key}`}
                >
                  {target.name}
                </button>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2 px-2.5 pt-1">
            <ActionButton action={reparent.unparent} onRun={run} testId="halo-scene-unparent" />
          </div>
          {reparent.note === null ? null : <p className="px-2.5 pt-1 text-touch-label text-fg-3">{reparent.note}</p>}
        </Section>

        <Section id="visibility">
          <div className="flex flex-wrap gap-2 px-2.5">
            <ActionButton action={visibility.showAll} onRun={run} testId="halo-scene-show-all" />
          </div>
          <div className="flex flex-col gap-1 px-2.5 pt-3">
            <span className="font-medium text-fg">Parts left out of the character</span>
            <span className="text-touch-label text-fg-3">Parts & fingers · Studio Pro: Hide Left-Out Parts</span>
            <div className="flex flex-wrap gap-2 pt-1">
              <ActionButton action={visibility.hideParts} onRun={run} testId="halo-scene-hide-parts" />
              <ActionButton action={visibility.showParts} onRun={run} testId="halo-scene-show-parts" />
            </div>
          </div>
        </Section>
      </div>
    </HaloSheet>
  );
}
