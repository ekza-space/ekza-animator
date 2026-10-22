// Rig & Skin pane overlays (M6B-SPEC §8.3, §8.12, §5.17; C7), registered by the lazy rig shell on the first entry:
//
// - the pose badge `BIND POSE` / `TEST POSE` through C0's viewport badge slot (`hud-badge-pose-<paneId>`, bottom right);
// - the HUD mode badge top left (`hud-rigmode-<paneId>`: `JOINT · SYM X` with the joint count chip, `SKIN`);
// - the empty state (no character): "Select a mesh to turn into a character, or a character", Quick Rig on the
//   selected meshes and "Edit a sample: Polybot (CC0)";
// - the dismissible Getting started card with the owner flow, keys read from the keymap;
// - below 1024 px the view-only banner "Open on a larger screen to edit" (§5.24, research 09 §11.2).
// Pane slots draw their latest registration, so each Rig overlay draws the slot's earlier component outside Rig & Skin.
import type { Disposer } from '@ekza-studio/anim-core';
import type { DocumentStore } from '@ekza-studio/doc';
import {
  type EditorApp,
  PANEL,
  RIG_VIEW_ONLY_REASON,
  type SessionState,
  type ViewportBadgeProvider,
} from '@ekza-studio/editor-core';
import { type ComponentType, type JSX, useRef, useState, useSyncExternalStore } from 'react';
import { useDocQuery, useRunOperator, useSession } from '../../../hooks';
import { scopeChain } from '../../../input/keyboard';
import { type PaneOverlayProps, type PaneOverlaySlot, paneOverlay, registerPaneOverlay } from '../../../overlays/slots';
import { shortcutFor } from '../../../shell/menus';
import { rigNarrow, subscribeRigNarrow } from '../../../shell/rig/viewOnly';
import { registerViewportBadge } from '../hud/badges';
import { overlayPane } from '../modelOverlays';
import { useOwnPointer } from '../ownPointer';

// ---------- the pose badge ----------

/** `BIND POSE` / `TEST POSE` in Rig & Skin (§5.17); hidden elsewhere. */
export function poseBadge(app: EditorApp): ViewportBadgeProvider {
  return {
    id: 'pose',
    label: (target) => {
      const s = target.session.getState();
      if (s.workspace !== 'rig') return null;
      return s.rig.poseView === 'test' ? 'TEST POSE' : 'BIND POSE';
    },
    subscribe: (listener) =>
      app.session.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace || state.rig.poseView !== previous.rig.poseView) listener();
      }),
  };
}

// ---------- the HUD mode badge ----------

/** The 15 bones VRM requires (§0.4.6 `vrm.required-bones`). */
const REQUIRED = [
  'hips',
  'spine',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
];

function jointChip(store: DocumentStore, character: string | null): string | null {
  const skeleton = character === null ? undefined : store.query.skeletonOfCharacter(character as never);
  if (skeleton === undefined) return null;
  const joints = store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null);
  const mapped = new Set(joints.map((joint) => joint.humanBone));
  const required = REQUIRED.filter((bone) => mapped.has(bone as never)).length;
  return `${joints.length} joints · ${required}/${REQUIRED.length} required`;
}

function RigModeBadge(props: PaneOverlayProps): JSX.Element | null {
  const mode = useSession((s) => s.rig.mode);
  const character = useSession((s) => s.rig.character);
  const symmetry = useDocQuery(
    (store) => (character === null ? false : (store.query.skeletonOfCharacter(character)?.symmetry ?? false)),
    ['skeletons'],
  );
  const chip = useDocQuery(
    (store) => (mode === 'skeleton' ? jointChip(store, character) : null),
    ['joints', 'skeletons'],
  );
  if (mode === 'object' || mode === 'shape') return null;
  const label = mode === 'skeleton' ? `JOINT${symmetry ? ' · SYM X' : ''}` : 'SKIN';
  return (
    <span className="flex items-center gap-1" data-testid={`hud-rigmode-${props.paneId}`}>
      <span className="rounded-sm bg-[var(--bg-pressed,#3a3d46)] px-1 text-[10px] font-semibold tracking-wide text-fg">
        {label}
      </span>
      {chip === null ? null : <span className="text-[10px] text-fg-3">{chip}</span>}
    </span>
  );
}

// ---------- the empty state ----------

const BUTTON =
  'pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] ' +
  'px-2 text-[12px] text-fg hover:border-[var(--border-strong,#4b4e58)] hover:bg-[var(--bg-hover,#30323a)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--accent-text,#a996ff)]';

const hostOf = (s: SessionState): string | null => (s.workspace === 'rig' ? overlayPane(s) : null);
const noCharacter = (store: DocumentStore): boolean => store.list('characters').length === 0;

export function RigEmptyState(props: PaneOverlayProps): JSX.Element | null {
  const host = useSession(hostOf);
  const empty = useDocQuery(noCharacter, ['characters']);
  const meshes = useDocQuery((store) => store.list('meshes').length > 0, ['meshes']);
  const selected = useSession((s) => s.selection.objects.length > 0);
  // A running Quick Rig is the next step already: the card would cover its markers and preview (acceptance fix).
  const quickRig = useSession((s) => s.rig.quickRig !== null);
  const run = useRunOperator();
  const card = useRef<HTMLDivElement>(null);
  useOwnPointer(card);
  if (host !== props.paneId || !empty || quickRig) return null;
  const ctx = { panel: PANEL.viewport, paneId: props.paneId, source: 'menu' as const };
  const hint = 'Select a mesh to turn into a character, or a character';
  // With meshes in the scene (a model handed over from Auto-Rig's ①) the card is a strip in the bottom left corner,
  // clear of the model's head (AR-R4-7); an empty scene keeps the card at the top
  return (
    <div
      ref={card}
      className={
        meshes
          ? 'pointer-events-auto m-3 mb-10 flex max-w-[28rem] flex-wrap items-center gap-2 self-end justify-self-start rounded-lg border border-line bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] px-3 py-2 text-[12px] text-fg-2 shadow-lg'
          : 'pointer-events-auto mt-10 flex self-start max-w-[28rem] flex-col items-center gap-2 rounded-lg border border-line bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] px-5 py-4 text-center text-[12px] text-fg-2 shadow-lg'
      }
      title={meshes ? hint : undefined}
      data-testid="rig-empty"
      data-compact={meshes}
    >
      <h2 className={meshes ? 'text-[12px] font-semibold text-fg' : 'text-[14px] font-semibold text-fg'}>Rig & Skin</h2>
      {meshes ? <p className="sr-only">{hint}</p> : <p>{hint}</p>}
      <div className="flex flex-wrap justify-center gap-1.5">
        {meshes ? (
          <button
            type="button"
            className={BUTTON}
            disabled={!selected}
            title={selected ? 'Place the joint markers on the selected meshes' : 'Select the meshes first'}
            data-testid="rig-empty-quickrig"
            onClick={() => void run('skel.quickRig.start', undefined, ctx)}
          >
            Quick Rig…
          </button>
        ) : null}
        <button
          type="button"
          className={BUTTON}
          data-testid="rig-empty-sample"
          onClick={() => void run('file.loadSample', { sample: 'polybot' }, ctx)}
        >
          Edit a sample: Polybot (CC0)
        </button>
      </div>
    </div>
  );
}

// ---------- the Getting started card ----------

/** Dismissed per browser. */
export const RIG_GETTING_STARTED_KEY = 'ekza-studio:rig-getting-started:v1';
const dismissListeners = new Set<() => void>();
let dismissedCache: boolean | null = null;

export function rigGettingStartedDismissed(): boolean {
  if (dismissedCache === null) {
    try {
      dismissedCache = globalThis.localStorage?.getItem(RIG_GETTING_STARTED_KEY) === 'dismissed';
    } catch {
      dismissedCache = false;
    }
  }
  return dismissedCache;
}

export function setRigGettingStartedDismissed(dismissed: boolean): void {
  dismissedCache = dismissed;
  try {
    if (dismissed) globalThis.localStorage?.setItem(RIG_GETTING_STARTED_KEY, 'dismissed');
    else globalThis.localStorage?.removeItem(RIG_GETTING_STARTED_KEY);
  } catch {
    // Blocked storage: dismissed for this page only.
  }
  for (const listener of Array.from(dismissListeners)) listener();
}

/** The owner flow (§0.1, §8.12), each key read from the keymap where it has one. */
export function gettingStartedSteps(app: EditorApp, paneId: string): readonly string[] {
  const scopes = scopeChain(app, { kind: PANEL.viewport, scope: PANEL.viewport, paneId }).scopes;
  const key = (op: string, args: unknown, fallback: string): string =>
    shortcutFor(app.keymap, op, args, scopes) ?? fallback;
  return [
    'Select your model, then Quick Rig: drag the markers in the front and side views',
    'Create Skeleton: Skeleton mode opens',
    // §0.2 step 5: no key press here (the Skeleton-mode key would toggle back to Object, §5.24).
    'Hold D and drag a knee (symmetry moves both)',
    'Bind Skin: one click, Skin mode opens',
    `Paint fixes (Skin mode: ${key('rig.mode', { mode: 'skin' }, '2')}); E on an elbow tries a pose`,
    'Clip Library: play a clip, Use Clip to edit it',
    'Export Character: VRM 1.0 for Space and OMOBA',
  ];
}

function RigGettingStarted(props: PaneOverlayProps): JSX.Element | null {
  const host = useSession(hostOf);
  // Quick Rig's panel guides its own step; the card would cover the markers in the host pane (acceptance fix).
  const quickRig = useSession((s) => s.rig.quickRig !== null);
  const dismissed = useSyncExternalStore(
    (listener) => {
      dismissListeners.add(listener);
      return () => dismissListeners.delete(listener);
    },
    rigGettingStartedDismissed,
    rigGettingStartedDismissed,
  );
  // While the empty state shows (no character yet) the card folds to its title: both sit at the pane's top and the
  // card covered the empty state's actions (AR-D9-12); a click on the title unfolds it, a character unfolds it.
  const empty = useDocQuery(noCharacter, ['characters']);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !empty;
  const card = useRef<HTMLDivElement>(null);
  useOwnPointer(card);
  if (host !== props.paneId || dismissed || quickRig) return null;
  return (
    <div
      ref={card}
      className="pointer-events-auto w-64 rounded-md border border-line bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] p-2 text-[11px] text-fg-2 shadow"
      data-testid="rig-getting-started"
      data-expanded={expanded}
    >
      <div className={`${expanded ? 'mb-1 ' : ''}flex items-center justify-between`}>
        <button
          type="button"
          className="pointer-events-auto font-semibold text-fg hover:underline"
          aria-expanded={expanded}
          data-testid="rig-getting-started-toggle"
          onClick={() => setOpen(!expanded)}
        >
          Getting started {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="pointer-events-auto px-1 text-fg-3 hover:text-fg"
          aria-label="Dismiss Getting started"
          data-testid="rig-getting-started-dismiss"
          onClick={() => setRigGettingStartedDismissed(true)}
        >
          ✕
        </button>
      </div>
      {expanded ? (
        <ol className="list-decimal space-y-0.5 pl-4">
          {gettingStartedSteps(props.app, props.paneId).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// ---------- the view-only banner ----------

/** Below 1024 px Rig & Skin is view-only (§5.24; research 09 §11.2): test poses and Validation still work. */
export function RigViewOnlyBanner(props: PaneOverlayProps): JSX.Element | null {
  const host = useSession(hostOf);
  const narrow = useSyncExternalStore(subscribeRigNarrow, rigNarrow, rigNarrow);
  if (host !== props.paneId || !narrow) return null;
  return (
    <output
      className="pointer-events-auto mb-1 block w-64 rounded-md border border-[var(--warn,#e3b34a)] bg-[color-mix(in_srgb,var(--bg-panel,#232428)_92%,transparent)] p-2 text-[11px] text-fg shadow"
      data-testid="rig-view-only"
    >
      <span className="font-semibold">{RIG_VIEW_ONLY_REASON}</span>
      <span className="block text-fg-2">Rig & Skin is view-only below 1024 px: test poses and Validation work.</span>
    </output>
  );
}

/** The banner above the Getting started card (one slot: both sit top right of the host pane). */
export function RigCards(props: PaneOverlayProps): JSX.Element {
  return (
    <div className="flex flex-col items-end">
      <RigViewOnlyBanner {...props} />
      <RigGettingStarted {...props} />
    </div>
  );
}

// ---------- registration ----------

/** Draws `component` in Rig & Skin and the slot's earlier registration elsewhere. */
function inRig(slot: PaneOverlaySlot, component: ComponentType<PaneOverlayProps>): ComponentType<PaneOverlayProps> {
  const previous = paneOverlay(slot);
  const Component = component;
  const Previous = previous;
  return function RigSlot(props: PaneOverlayProps): JSX.Element | null {
    const rig = useSession((s) => s.workspace === 'rig');
    if (rig) return <Component {...props} />;
    return Previous === null ? null : <Previous {...props} />;
  };
}

export function registerRigOverlays(app: EditorApp): Disposer {
  const disposers = [
    registerViewportBadge(poseBadge(app)),
    registerPaneOverlay('hud', inRig('hud', RigModeBadge)),
    registerPaneOverlay('emptyState', inRig('emptyState', RigEmptyState)),
    registerPaneOverlay('gettingStarted', inRig('gettingStarted', RigCards)),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
