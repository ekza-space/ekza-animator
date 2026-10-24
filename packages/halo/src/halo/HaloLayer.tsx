// The layer over the canvas where the grammar shows (STUDIO-TOUCH-SPEC §4.1, §6.1, §6.5): the breadcrumb above the
// selection, the Halo beside it (an arc after a tap; a compass ring after a long-press or a right-click; a docked verb
// bar on Compact containers, §4.4), the Echo chips, the Reselect chip (§5.2), the Loupe (§5.4) and the screen-reader
// announcement (§18). Everything is anchored to the selection's on-screen box and never covers it (AS-ST-18); the
// Halo fades while a finger orbits (breathing chrome, §4.7) and comes back when it lifts.
import { ActionChip, type Box, LoupeChips, VerbBar, type VerbItem, VerbRing } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { EchoChips } from '../chips/EchoChips';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { type SizeClass, useDocumentVersion, useSessionValue } from '../shell/hooks';
import { useHaloStore } from '../shell/store';
import { ConfirmCard } from '../dialogs/ConfirmCard';
import { Breadcrumb } from './Breadcrumb';
import { selectionBox } from './geometry';
import { Icon } from './icons';
import { FACE_OPS } from './run';
import { opOf, type Verb } from './verbSource';

const FormChips = lazy(() => import('../chips/FormChips'));

/** The reduced Halo after a face operation (§6.1): Pull again · Bevel · Inset, no ⋯ More. */
function reducedPetals(petals: readonly { verb: Verb; reason: string | null }[], last: string | null) {
  const order = ['mesh.extrude', 'mesh.bevel', 'mesh.inset'];
  return petals
    .filter((p) => FACE_OPS.has(opOf(p.verb) ?? ''))
    .sort((a, b) => order.indexOf(opOf(a.verb) ?? '') - order.indexOf(opOf(b.verb) ?? ''))
    .map((p) => (opOf(p.verb) === last ? { ...p, verb: { ...p.verb, label: en.verbs.repeat(p.verb.label) } } : p));
}

export function HaloLayer({
  controller,
  width,
  height,
  size,
  insetTop,
  insetBottom,
}: {
  readonly controller: HaloController;
  readonly width: number;
  readonly height: number;
  readonly size: SizeClass;
  /** Below the top bar (px from the frame's top). */
  readonly insetTop: number;
  /** Above the tray (px from the frame's bottom). */
  readonly insetBottom: number;
}): JSX.Element {
  const { ctx, grammar, verbs } = controller;
  const { store, app } = ctx;
  const halo = useHaloStore(store, (s) => s.halo);
  const anchor = useHaloStore(store, (s) => s.anchor);
  const stage = useHaloStore(store, (s) => s.stage);
  const breathing = useHaloStore(store, (s) => s.breathing);
  const reselect = useHaloStore(store, (s) => s.reselect);
  const loupe = useHaloStore(store, (s) => s.loupe);
  const form = useHaloStore(store, (s) => s.form);
  const confirm = useHaloStore(store, (s) => s.confirm);
  const handedness = useHaloStore(store, (s) => s.input.handedness);
  const selection = useSessionValue(app, (s) => s.selection);
  const components = useSessionValue(app, (s) => s.model.components.version);
  const lastRun = useSessionValue(app, (s) => s.lastRun);
  const version = useDocumentVersion(app);
  // the box follows the camera: measured again when a gesture ends and on every selection or document change
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (breathing) return undefined;
    const raf = requestAnimationFrame(() => setFrame((f) => f + 1));
    return () => cancelAnimationFrame(raf);
  }, [breathing, selection, components, version, halo]);

  const noun = useMemo(
    () => verbs.noun(app, stage),
    // the selection, the component counts, the document and the stage decide the noun
    // oxlint-disable-next-line react/exhaustive-deps
    [verbs, app, stage, selection, components, version],
  );
  const box: Box | null = useMemo(
    () => (noun === null ? null : selectionBox(app, ctx.vm(), anchor)),
    // measured per frame tick (`frame`) as well as on selection changes
    // oxlint-disable-next-line react/exhaustive-deps
    [app, ctx, anchor, noun, frame],
  );

  const haloNoun = halo === null ? null : grammar.noun();
  const petals = haloNoun === null ? [] : grammar.petals();
  const shown = halo?.reduced === true ? reducedPetals(petals, lastRun?.id ?? null) : petals;
  const items: VerbItem[] = shown.map(({ verb, reason }) => ({
    id: verb.id,
    label: verb.label,
    ...(verb.proName === undefined ? {} : { proName: verb.proName }),
    ...(verb.icon === undefined ? {} : { icon: <Icon name={verb.icon} /> }),
    ...(verb.slot === undefined ? {} : { slot: verb.slot }),
    ...(verb.hasMenu === true ? { hasMenu: true } : {}),
    ...(verb.changed === true ? { changed: true } : {}),
    ...(reason === null ? {} : { disabledReason: reason }),
  }));
  const select = (id: string): void => {
    const verb = shown.find((p) => p.verb.id === id)?.verb;
    if (verb !== undefined) controller.runVerb(verb, 'petal');
  };
  const reason = (_id: string, text: string): void => {
    ctx.toasts.push({ key: 'reason', text });
  };
  const more = (): void => store.set({ sheet: 'more', halo: null });
  const hot = halo?.mode === 'ring' && halo.hot !== null && halo.hot !== undefined ? halo.hot : null;
  const hotVerb =
    hot === null
      ? null
      : (shown[grammar.slots().indexOf(hot)]?.verb.id ?? (hot === grammar.slots()[shown.length] ? 'more' : null));

  // §18: canvas selections are announced through a live region
  const announce = haloNoun === null ? '' : en.halo.announce(haloNoun.label, items.length);

  const compact = size === 'compact';
  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-(--motion-touch)"
      style={breathing ? { opacity: 0.15 } : undefined}
      data-halo-layer=""
    >
      {noun !== null && halo?.mode !== 'ring' ? (
        <Breadcrumb controller={controller} noun={noun} box={box} width={width} above={insetTop} />
      ) : null}
      {halo !== null && haloNoun !== null && compact && halo.mode === 'arc' ? (
        <div
          className="pointer-events-auto absolute inset-x-(--touch-inset-left)"
          style={{ bottom: insetBottom + 8 }}
          data-halo-chrome=""
        >
          <VerbBar
            data-testid="halo-ring"
            label={haloNoun.label}
            verbs={items}
            onSelect={select}
            onMore={more}
            onReason={reason}
          />
        </div>
      ) : halo !== null && haloNoun !== null ? (
        <div className="absolute inset-0" data-halo-hot={hotVerb ?? undefined}>
          {hotVerb === null ? null : (
            <style>{`[data-halo-hot="${CSS.escape(hotVerb)}"] [data-verb="${CSS.escape(hotVerb)}"]{background:var(--accent-fill);color:var(--on-accent)}`}</style>
          )}
          <VerbRing
            key={halo.mode === 'ring' ? `ring-${halo.at?.x ?? 0}-${halo.at?.y ?? 0}` : `arc-${haloNoun.kind}`}
            data-testid="halo-ring"
            mode={halo.mode}
            label={haloNoun.label}
            verbs={items}
            {...(box === null ? {} : { target: box })}
            {...(halo.mode === 'ring' && halo.at !== null ? { center: halo.at } : {})}
            width={width}
            height={height}
            prefer={handedness === 'right' ? 'left' : 'right'}
            insetTop={insetTop}
            insetBottom={insetBottom}
            hideMore={halo.reduced === true}
            onSelect={select}
            onMore={more}
            onReason={reason}
            onDismiss={() => grammar.close()}
          />
        </div>
      ) : null}
      {noun !== null && form === null && halo?.mode !== 'ring' ? (
        <EchoChips controller={controller} box={box} width={width} height={height} insetBottom={insetBottom} />
      ) : null}
      {form === null ? null : (
        <Suspense fallback={null}>
          <FormChips key={form.op} controller={controller} box={box} width={width} insetBottom={insetBottom} />
        </Suspense>
      )}
      {confirm === null ? null : <ConfirmCard controller={controller} box={box} width={width} />}
      {reselect === null ? null : (
        <div
          className="pointer-events-auto absolute left-1/2 -translate-x-1/2"
          style={{ bottom: insetBottom + 64 }}
          data-halo-chrome=""
        >
          <ActionChip data-testid="halo-reselect" icon={<Icon name="again" />} onClick={() => grammar.reselect()}>
            {en.halo.reselect}
          </ActionChip>
        </div>
      )}
      {loupe === null ? null : (
        <div className="pointer-events-auto absolute inset-0" data-halo-chrome="">
          <LoupeChips
            data-testid="halo-loupe"
            label={en.halo.loupe}
            candidates={loupe.candidates}
            anchor={loupe.at}
            onPick={(id) => grammar.pick(id)}
          />
        </div>
      )}
      <p className="sr-only" aria-live="polite" data-testid="halo-announce">
        {announce}
      </p>
    </div>
  );
}
