'use client';

// The touch kit's gallery (STUDIO-TOUCH-SPEC §21 T4): a mock canvas laid out like Ekza Studio's Simple layout —
// top bar with the Path, breadcrumb, the Halo beside a selected face, Echo chips with the numpad, the off-hand
// column with ↶ and the Thumb key, the tray, toasts, the More sheet — and one card per primitive below it.
import { type JSX, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
// oxlint-disable-next-line no-restricted-imports -- the touch kit's own subpath (`@ekza-studio/ui/touch`, T4); the dev-route allow-list gains it at the Halo integration (docs/wp-notes/halo-t4.md)
import {
  ActionChip,
  type Box,
  Cluster,
  createToastStore,
  Glyph,
  installTouchPolicy,
  type LoupeCandidate,
  LoupeChips,
  Numpad,
  type Point,
  Segmented,
  Sheet,
  SheetGroup,
  SheetRow,
  Stepper,
  ThumbKey,
  ToastRegion,
  ToggleChip,
  TouchButton,
  TouchIconButton,
  TouchRoot,
  useLongPress,
  useThumbKey,
  ValueChip,
  VerbBar,
  type VerbItem,
  VerbRing,
} from '@ekza-studio/ui/touch';

const ICON_PATHS = {
  pull: 'M12 19V5M5 12l7-7 7 7M4 21h16',
  inset: 'M4 4h16v16H4zM9 9h6v6H9z',
  bevel: 'M8 3h8l5 5v8l-5 5H8l-5-5V8z',
  colour:
    'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2-1 3-1a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  shape: 'M12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  options: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
} as const;

function Icon({ name }: { readonly name: keyof typeof ICON_PATHS }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const FACE_VERBS: readonly VerbItem[] = [
  { id: 'pull', label: 'Pull', proName: 'Extrude', icon: <Icon name="pull" />, slot: 'N' },
  { id: 'inset', label: 'Inset', proName: 'Inset Faces', icon: <Icon name="inset" />, slot: 'E' },
  { id: 'bevel', label: 'Bevel', proName: 'Bevel', icon: <Icon name="bevel" />, slot: 'S' },
  { id: 'colour', label: 'Colour', icon: <Icon name="colour" />, slot: 'W' },
  { id: 'bridge', label: 'Bridge', proName: 'Bridge', disabledReason: 'Needs two open borders', slot: 'NE' },
  { id: 'delete', label: 'Delete', proName: 'Delete Faces', icon: <Icon name="delete" />, slot: 'SW' },
];

const SPACE_VERBS: readonly VerbItem[] = [
  { id: 'shape', label: 'New shape', hasMenu: true, slot: 'N' },
  { id: 'template', label: 'Template', hasMenu: true, slot: 'E' },
  { id: 'select-area', label: 'Select area', slot: 'S' },
  { id: 'paste', label: 'Paste', slot: 'W' },
];

const KEY_VERBS: readonly VerbItem[] = [
  { id: 'ease', label: 'Ease', hasMenu: true },
  { id: 'inbetween', label: 'In-between' },
  { id: 'copy', label: 'Copy' },
  { id: 'delete-key', label: 'Delete' },
  { id: 'all-here', label: 'All keys here' },
  { id: 'weighted', label: 'Weighted', on: false },
];

const LOUPE: readonly LoupeCandidate[] = [
  { id: 'index1', label: 'Index 1' },
  { id: 'index2', label: 'Index 2' },
  { id: 'hand', label: 'Hand control' },
  { id: 'body', label: 'Body mesh' },
];

// The gallery's own one-off looks are inline styles, so its page adds no utilities to the shared stylesheet.
const CANVAS_BACKGROUND =
  'radial-gradient(circle at 50% 120%, rgba(124, 92, 255, 0.08), transparent 60%), linear-gradient(var(--viewport-top), var(--viewport-bottom))';
const SELECTED_FACE = {
  borderRadius: 6,
  border: '2px solid var(--comp-selected)',
  background: 'rgba(255, 163, 26, 0.35)',
} as const;

type Stage = 'make' | 'paint' | 'rig' | 'animate';
type Pick = 'whole' | 'points' | 'edges' | 'faces';
type Scale = '0.85' | '1' | '1.25' | '1.5';

function Card({
  title,
  children,
  wide,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly wide?: boolean;
}): JSX.Element {
  return (
    <section
      aria-label={title}
      className={`flex flex-col gap-3 rounded-touch-card border border-line bg-panel p-4 ${wide === true ? 'md:col-span-2' : ''}`}
    >
      <h2 className="text-touch-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function TouchGallery(): JSX.Element {
  const [scale, setScale] = useState<Scale>('1');
  const [toasts] = useState(() => createToastStore());
  const say = (text: string, action?: { label: string; run: () => void }): void => {
    toasts.push({ text, key: text.startsWith('Undid') ? 'undo' : text, ...(action === undefined ? {} : { action }) });
  };

  // ── the canvas demo ──
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1100, height: 640 });
  useLayoutEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const read = (): void => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Phone-width containers (< 700 px) get the Compact layout (§4.4): the Halo docks as a verb bar, the Path becomes
  // a tab bar at the bottom, chips go under the selection.
  const compact = size.width < 700;
  const faceLeft = compact ? Math.round(size.width / 2 - 52) : Math.round(size.width * 0.42);
  const target: Box = { left: faceLeft, top: compact ? 200 : 230, right: faceLeft + 104, bottom: compact ? 324 : 354 };
  const [ring, setRing] = useState<{ readonly mode: 'arc' } | { readonly mode: 'ring'; readonly center: Point } | null>(
    {
      mode: 'arc',
    },
  );
  const [stage, setStage] = useState<Stage>('make');
  const [pick, setPick] = useState<Pick>('faces');
  const [mirror, setMirror] = useState(true);
  const [falloff, setFalloff] = useState(false);
  const [snap, setSnap] = useState(false);
  const [distance, setDistance] = useState(0.07);
  const [segments, setSegments] = useState(2);
  const [numpad, setNumpad] = useState<{ readonly chip: 'distance' | 'segments'; readonly at: Point } | null>(null);
  const [more, setMore] = useState(false);
  const [thumb, dispatchThumb] = useThumbKey();

  // The numpad opens beside its chip, below the chip row and clear of the other chips and the selection.
  const openNumpad = (chip: 'distance' | 'segments') => (el: HTMLElement) => {
    const host = canvas.current?.getBoundingClientRect();
    const row = el.parentElement?.getBoundingClientRect();
    if (host === undefined || row === undefined) return;
    const r = el.getBoundingClientRect();
    const x = compact
      ? Math.max(16, (host.width - 296) / 2)
      : Math.max(target.right + 16, Math.min(r.left - host.left, host.width - 296 - 16));
    setNumpad({ chip, at: { x, y: row.bottom - host.top + 12 } });
  };

  const backdrop = useLongPress({
    onTap: () => {
      setRing(null);
      setNumpad(null);
    },
    onLongPress: (e) => {
      const host = canvas.current?.getBoundingClientRect();
      if (host !== undefined) setRing({ mode: 'ring', center: { x: e.x - host.left, y: e.y - host.top } });
    },
  });

  // ── the cards ──
  const [policy, setPolicy] = useState(false);
  useEffect(() => (policy ? installTouchPolicy() : undefined), [policy]);
  const [count, setCount] = useState(3);
  const [segmentsRow, setSegmentsRow] = useState<'timeline' | 'keys' | 'curves'>('keys');
  const [bottomSheet, setBottomSheet] = useState(false);
  const [loupe, setLoupe] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [lockState, dispatchLock] = useThumbKey();

  const path = (
    <Cluster className="max-w-full overflow-x-auto p-[3px]" data-touch-scroll="">
      <Segmented<Stage>
        kind="tablist"
        variant="accent"
        label="Stage"
        data-testid="touch-path"
        value={stage}
        onValueChange={setStage}
        items={[
          { value: 'make', label: 'Make', badge: <span aria-hidden="true">●</span> },
          { value: 'paint', label: 'Paint', badge: <span aria-hidden="true">○</span> },
          { value: 'rig', label: 'Rig', badge: <span aria-hidden="true">○</span> },
          { value: 'animate', label: 'Animate', badge: <span aria-hidden="true">○</span> },
        ]}
      />
    </Cluster>
  );

  return (
    <TouchRoot uiScale={Number(scale)} className="min-h-dvh bg-app">
      <main className="mx-auto flex flex-col gap-6 px-(--touch-inset-left) py-6" style={{ maxWidth: 1240 }}>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1
              className="text-touch-title font-semibold"
              style={{ fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.02em' }}
            >
              Touch kit
            </h1>
            <p className="text-fg-2" style={{ maxWidth: '60ch' }}>
              The primitives of Ekza Studio’s Simple layout: 44 px targets, 16 px gutters and input text, a visible
              focus ring, reduced motion honoured. Tap a petal, drag a value chip sideways, tap it for the numpad,
              long-press the canvas for the ring.
            </p>
          </div>
          <Segmented<Scale>
            label="Text & touch size"
            data-testid="touch-scale"
            value={scale}
            onValueChange={setScale}
            items={[
              { value: '0.85', label: '85%' },
              { value: '1', label: '100%' },
              { value: '1.25', label: '125%' },
              { value: '1.5', label: '150%' },
            ]}
          />
        </header>

        <section
          aria-label="Canvas demo"
          ref={canvas}
          data-testid="touch-canvas"
          className="relative overflow-hidden rounded-touch-card border border-line"
          style={{ height: compact ? 1180 : 940, background: CANVAS_BACKGROUND }}
        >
          {/* The empty canvas: tap clears, long-press opens the ring at the finger. */}
          <div aria-hidden="true" data-testid="touch-backdrop" className="absolute inset-0 touch-none" {...backdrop} />
          {/* The selected face (stands in for the 3D view). */}
          <button
            type="button"
            aria-label="Selected face"
            data-testid="touch-selection"
            className="absolute"
            style={{
              ...SELECTED_FACE,
              left: target.left,
              top: target.top,
              width: target.right - target.left,
              height: target.bottom - target.top,
            }}
            onClick={() => setRing({ mode: 'arc' })}
          />

          <div className="absolute inset-x-0 top-0 flex items-center gap-2.5 px-(--touch-inset-left) py-2">
            <Cluster className="flex items-center">
              <TouchButton variant="ghost" className="text-fg" icon={<Glyph name="down" size={18} />}>
                Polybot
              </TouchButton>
            </Cluster>
            {compact ? null : path}
            <span className="flex-1" />
            <Cluster className="hidden md:flex">
              <TouchButton variant="ghost" className="justify-start font-normal text-fg-2" style={{ minWidth: 220 }}>
                Do or find…
              </TouchButton>
            </Cluster>
            <Cluster className="flex">
              <TouchButton variant="ghost" className="text-fg">
                Share
              </TouchButton>
            </Cluster>
          </div>

          <Cluster
            className="absolute flex h-(--touch-hit) -translate-x-1/2 items-center rounded-full px-1 text-[14px]"
            style={{ left: (target.left + target.right) / 2, top: target.top - 64 }}
          >
            <nav aria-label="Selection path" className="flex items-center">
              {compact ? null : (
                <>
                  <TouchButton variant="ghost" className="px-2.5 font-normal">
                    Polybot
                  </TouchButton>
                  <span aria-hidden="true" className="text-fg-3">
                    ›
                  </span>
                </>
              )}
              <TouchButton variant="ghost" className="px-2.5 font-normal">
                Head
              </TouchButton>
              <span aria-hidden="true" className="text-fg-3">
                ›
              </span>
              <TouchButton variant="ghost" className="px-2.5 text-fg" aria-current="true">
                1 face
              </TouchButton>
            </nav>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-line-strong" />
            <TouchButton variant="ghost" className="px-2.5 text-accent-text">
              Numbers
            </TouchButton>
          </Cluster>

          {ring !== null && ring.mode === 'arc' && compact ? (
            <div
              className="absolute inset-x-(--touch-inset-left)"
              style={{ bottom: 'calc(var(--touch-inset-bottom) + 124px)' }}
            >
              <VerbBar
                data-testid="touch-halo"
                label="1 face"
                verbs={FACE_VERBS.filter((v) => v.id !== 'bridge')}
                onSelect={(id) => say(`Ran ${id}`)}
                onMore={() => setMore(true)}
                onReason={(_id, reason) => say(reason)}
              />
            </div>
          ) : ring === null ? null : (
            <VerbRing
              key={ring.mode === 'ring' ? `ring-${ring.center.x}-${ring.center.y}` : 'arc'}
              data-testid="touch-halo"
              mode={ring.mode}
              label={ring.mode === 'ring' ? 'Empty space' : '1 face'}
              verbs={ring.mode === 'ring' ? SPACE_VERBS : FACE_VERBS.filter((v) => v.id !== 'bridge')}
              target={target}
              {...(ring.mode === 'ring' ? { center: ring.center } : {})}
              width={size.width}
              height={size.height}
              insetTop={target.top - 16}
              insetBottom={96}
              onSelect={(id) => {
                say(`Ran ${id}`);
                setRing(null);
              }}
              onMore={() => setMore(true)}
              onReason={(_id, reason) => say(reason)}
              onDismiss={() => setRing(null)}
            />
          )}

          <div
            className={`absolute flex flex-wrap items-center gap-2 ${compact ? 'justify-center' : ''}`}
            style={
              compact
                ? { left: 16, right: 16, top: target.bottom + 20 }
                : { left: target.right + 24, top: target.top + 12, maxWidth: size.width - target.right - 40 }
            }
          >
            <ValueChip
              data-testid="touch-chip-distance"
              label="Distance"
              proName="Extrude offset"
              value={distance}
              step={0.01}
              unit="m"
              min={0}
              modifier={thumb.latch === 'off' ? 1 : 0.1}
              onChange={setDistance}
              onCommit={() => dispatchThumb({ type: 'consume' })}
              onOpenNumpad={openNumpad('distance')}
              onMenu={() => say('Distance: Reset · Make default')}
            />
            <ValueChip
              data-testid="touch-chip-segments"
              label="Segments"
              value={segments}
              step={1}
              min={1}
              max={12}
              onChange={setSegments}
              onOpenNumpad={openNumpad('segments')}
            />
            <ActionChip icon={<Icon name="options" />}>Options</ActionChip>
          </div>

          {numpad === null ? null : (
            <Numpad
              data-testid="touch-numpad"
              className="absolute z-(--z-popover)"
              style={{ left: numpad.at.x, top: numpad.at.y }}
              label={numpad.chip === 'distance' ? 'Distance' : 'Segments'}
              proName={numpad.chip === 'distance' ? 'Extrude offset' : 'Divisions'}
              value={numpad.chip === 'distance' ? distance : segments}
              {...(numpad.chip === 'distance' ? { unit: 'm', min: 0 } : { min: 1, max: 12 })}
              onDone={(v) => {
                if (numpad.chip === 'distance') setDistance(v);
                else setSegments(Math.round(v));
                setNumpad(null);
              }}
              onNext={(v) => {
                if (numpad.chip === 'distance') {
                  setDistance(v);
                  setNumpad((n) => (n === null ? null : { ...n, chip: 'segments' }));
                } else {
                  setSegments(Math.round(v));
                  setNumpad(null);
                }
              }}
              onCancel={() => setNumpad(null)}
            />
          )}

          <div
            className="absolute left-(--touch-inset-left) flex flex-col items-start gap-2.5"
            style={{ bottom: `calc(var(--touch-inset-bottom) + ${compact ? 184 : 76}px)` }}
          >
            <TouchIconButton
              size="lg"
              label="Undo"
              icon={<Icon name="undo" />}
              onClick={() => say('Undid: Pull', { label: 'Redo', run: () => say('Redid: Pull') })}
            />
            <ThumbKey
              data-testid="touch-thumb"
              state={thumb}
              dispatch={dispatchThumb}
              tap={{ glyph: '⊕', label: 'select more' }}
              drag={{ glyph: '≈', label: 'fine' }}
              choices={[
                { id: 'pick', glyph: '⊙', label: 'Pick or unpick', proName: 'Mod + click' },
                { id: 'unselect', glyph: '⊖', label: 'Unselect', proName: 'Mod + Shift' },
                { id: 'coarse', glyph: '×', label: 'Coarse ×10', proName: 'Mod + drag' },
              ]}
              onChoose={(id) => say(`Thumb key: ${id}`)}
            />
          </div>

          <ToastRegion
            store={toasts}
            data-testid="touch-toasts"
            className={
              compact
                ? 'absolute top-[68px] left-1/2 -translate-x-1/2'
                : 'absolute bottom-[calc(var(--touch-inset-bottom)+76px)] left-1/2 -translate-x-1/2'
            }
          />

          {compact ? (
            <div className="absolute inset-x-0 bottom-(--touch-inset-bottom) flex justify-center px-(--touch-inset-left)">
              {path}
            </div>
          ) : null}
          <div
            className="absolute inset-x-0 flex justify-center px-(--touch-inset-left)"
            style={{ bottom: `calc(var(--touch-inset-bottom) + ${compact ? 60 : 0}px)` }}
          >
            <Cluster className="flex max-w-full items-center gap-1.5 overflow-x-auto p-[5px]" data-touch-scroll="">
              <Segmented<Pick>
                label="Pick"
                data-testid="touch-pick"
                value={pick}
                onValueChange={setPick}
                items={[
                  { value: 'whole', label: 'Whole' },
                  { value: 'points', label: 'Points' },
                  { value: 'edges', label: 'Edges' },
                  { value: 'faces', label: 'Faces' },
                ]}
              />
              <ToggleChip label="Mirror edits" pressed={mirror} onPressedChange={setMirror} className="shadow-none" />
              <ToggleChip label="Falloff" pressed={falloff} onPressedChange={setFalloff} className="shadow-none" />
              <ToggleChip
                label="Snap"
                data-testid="touch-snap"
                pressed={snap}
                onPressedChange={setSnap}
                className="shadow-none"
              />
              <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-line-strong" />
              <TouchButton variant="ghost" icon={<Icon name="shape" />}>
                New shape
              </TouchButton>
              <TouchIconButton
                label="More tools"
                icon={<Glyph name="more" />}
                className="border-0 bg-transparent shadow-none"
              />
            </Cluster>
          </div>

          <Sheet
            data-testid="touch-more-sheet"
            open={more}
            onOpenChange={setMore}
            modal={false}
            title="Everything for 1 face"
            description="Plain name · Pro name · hotkey"
            footer={
              <TouchButton className="flex-1" onClick={() => setMore(false)}>
                Open this in the Pro layout
              </TouchButton>
            }
          >
            <SheetGroup>Shape</SheetGroup>
            <SheetRow
              title="Pull"
              detail="Extrude · ⌘E"
              trailing={<Icon name="options" />}
              onClick={() => say('Ran pull')}
            />
            <SheetRow title="Inset" detail="Inset Faces" onClick={() => say('Ran inset')} />
            <SheetRow title="Bevel" detail="Bevel · ⌘B" onClick={() => say('Ran bevel')} />
            <SheetRow title="Bridge to…" detail="Bridge · Needs two open borders" disabled />
            <SheetRow title="Extract" detail="Extract Faces" />
            <SheetRow title="Fill hole" detail="Fill Hole · No open edges here" disabled />
            <SheetGroup>Select</SheetGroup>
            <SheetRow title="Loop" detail="Select Edge Loop" />
            <SheetRow title="Grow" detail="Grow Selection" />
          </Sheet>
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card title="Segmented and stepper">
            <Segmented<'timeline' | 'keys' | 'curves'>
              label="Thread layer"
              kind="tablist"
              value={segmentsRow}
              onValueChange={setSegmentsRow}
              items={[
                { value: 'timeline', label: 'Timeline' },
                { value: 'keys', label: 'Keys' },
                { value: 'curves', label: 'Curves' },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Stepper data-testid="touch-stepper" label="Cuts" value={count} min={1} max={12} onChange={setCount} />
              <Stepper label="Turn X" value={-12.5} step={0.5} unit="°" hideLabel onChange={() => undefined} />
            </div>
          </Card>

          <Card title="Buttons and chips">
            <div className="flex flex-wrap gap-2">
              <TouchButton variant="primary">Rig it for me</TouchButton>
              <TouchButton>Add animation</TouchButton>
              <TouchButton variant="ghost">Cancel</TouchButton>
              <TouchButton variant="danger">Discard</TouchButton>
              <TouchButton disabled>Export</TouchButton>
            </div>
            <div className="flex flex-wrap gap-2">
              <ValueChip label="Bend" value={34} step={1} unit="°" proName="Rotate X" state="keyed" />
              <ValueChip label="Side" value={-5} step={1} unit="°" proName="Rotate Z" state="altered" />
              <ToggleChip label="Pressure" pressed />
            </div>
          </Card>

          <Card title="Verb bar (phone width)" wide>
            <div
              className="w-full rounded-touch border border-line bg-app p-2"
              style={{ maxWidth: 390 }}
              data-testid="touch-verbbar"
            >
              <VerbBar
                label="Key dot"
                verbs={KEY_VERBS}
                onSelect={(id) => say(`Ran ${id}`)}
                onMore={(folded) => say(`More: ${folded.join(', ') || 'everything else'}`)}
              />
            </div>
          </Card>

          <Card title="Loupe chips">
            <p className="text-fg-2">Overlapping candidates under a finger become named chips above it.</p>
            <div className="relative rounded-touch border border-line bg-app" style={{ height: 180 }}>
              <TouchButton className="absolute bottom-3 left-3" onClick={() => setLoupe((v) => !v)}>
                {loupe ? 'Close the Loupe' : 'Touch overlapping parts'}
              </TouchButton>
              {loupe ? (
                <LoupeChips
                  data-testid="touch-loupe"
                  candidates={LOUPE}
                  anchor={{ x: 200, y: 150 }}
                  onPick={(id) => {
                    setPicked(id);
                    setLoupe(false);
                  }}
                />
              ) : null}
            </div>
            <p className="text-touch-label text-fg-3" aria-live="polite">
              {picked === null ? 'Nothing picked' : `Picked ${picked}`}
            </p>
          </Card>

          <Card title="Bottom sheet">
            <p className="text-fg-2">Portrait and phones: peek, half and full, set by the grab bar.</p>
            <div className="relative overflow-hidden rounded-touch border border-line bg-app" style={{ height: 300 }}>
              <TouchButton className="absolute top-3 left-3" onClick={() => setBottomSheet(true)}>
                Show Numbers
              </TouchButton>
              <Sheet
                data-testid="touch-bottom-sheet"
                open={bottomSheet}
                onOpenChange={setBottomSheet}
                side="bottom"
                defaultDetent="half"
                title="Numbers · Forearm R"
              >
                <div className="flex flex-wrap gap-2 py-2">
                  <ValueChip label="Bend" value={34} step={1} unit="°" proName="Rotate X" />
                  <ValueChip label="Twist" value={0} step={1} unit="°" proName="Rotate Y" />
                </div>
              </Sheet>
            </div>
          </Card>

          <Card title="Thumb key states">
            <div className="flex flex-wrap items-center gap-3">
              <ThumbKey state={lockState} dispatch={dispatchLock} tap={{ glyph: '✦', label: 'fill part' }} />
              <TouchButton onClick={() => dispatchLock({ type: 'key', time: performance.now() })}>Tap</TouchButton>
              <TouchButton
                onClick={() => {
                  const t = performance.now();
                  dispatchLock({ type: 'key', time: t });
                  dispatchLock({ type: 'key', time: t + 1 });
                }}
              >
                Double-tap
              </TouchButton>
            </div>
            <p className="text-touch-label text-fg-3">
              Latch: {lockState.latch}. A tap applies to the next action, a double-tap locks, a hold lasts while held.
            </p>
          </Card>

          <Card title="Shell policy">
            <p className="text-fg-2">
              While a touch shell is mounted the page never pinch-zooms, pans or pulls to refresh; text fields and sheet
              lists keep their scrolling.
            </p>
            <ToggleChip
              data-testid="touch-policy"
              label="No page zoom or pan"
              pressed={policy}
              onPressedChange={setPolicy}
              className="self-start"
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-touch-label text-fg-3">A text field keeps 16 px text</span>
              <input
                data-testid="touch-input"
                className="min-h-(--touch-hit) rounded-touch border border-line-strong bg-field px-3 text-fg"
                defaultValue="Polybot"
              />
            </label>
          </Card>
        </div>
      </main>
    </TouchRoot>
  );
}
