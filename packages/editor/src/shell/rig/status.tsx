// Status-line groups of Rig & Skin (M6B-SPEC §8.2, §5.24; C7): `Mode [Obj|Joint|Skin] │ Pose [Bind|Test] │ Sym X ✓ │
// Snap ◎Ctr │ Joint ⊖⊕ ◌Xray ⊹Axes`. Registered as bodies of the workspace's status groups (`registerStatusGroup`) by
// the lazy rig shell; Skin mode swaps the symmetry, snap and joint groups for the brush strip (the `brush` group, whose
// body C6 registers). Every control runs an operator, except the projected-centre snap: a session toggle (U state)
// that no MVP operator owns.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  paneDisplayPort,
  type PoseView,
  type RigMode,
  type RigSessionState,
} from '@ekza-studio/editor-core';
import { Toggle, ToggleGroup, ToggleGroupItem, Tooltip } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useDocQuery, usePrefs, useSession } from '../../hooks';
import { shortcutFor } from '../menus';
import { registerStatusGroup, type StatusGroupProps } from '../statusGroupRegistry';
import { useReasons } from './hooks';

function Tip(props: { readonly text: string; readonly children: JSX.Element }): JSX.Element {
  return <Tooltip content={props.text}>{props.children}</Tooltip>;
}

const MODES: readonly { readonly mode: RigMode; readonly short: string; readonly label: string }[] = [
  { mode: 'object', short: 'Obj', label: 'Object mode' },
  { mode: 'skeleton', short: 'Joint', label: 'Skeleton mode' },
  { mode: 'skin', short: 'Skin', label: 'Skin mode' },
];
const MODE_POLLS = MODES.map((entry) => ['rig.mode', { mode: entry.mode }] as const);

function hint(app: EditorApp, op: string, args: unknown): string {
  const key = shortcutFor(app.keymap, op, args);
  return key === null ? '' : `  ${key}`;
}

export function RigModeBody(props: StatusGroupProps): JSX.Element {
  const mode = useSession((s) => s.rig.mode);
  const reasons = useReasons(props.app, MODE_POLLS);
  return (
    <ToggleGroup
      type="single"
      value={mode}
      aria-label="Rig & Skin mode"
      onValueChange={(value) => {
        if (value !== '' && value !== mode) props.run('rig.mode', { mode: value });
      }}
    >
      {MODES.map((entry, i) => {
        const reason = entry.mode === mode ? null : (reasons[i] ?? null);
        const text = `${entry.label}${hint(props.app, 'rig.mode', { mode: entry.mode })}${reason === null ? '' : ` (${reason})`}`;
        return (
          <Tip key={entry.mode} text={text}>
            <ToggleGroupItem
              value={entry.mode}
              aria-label={text.trim()}
              data-testid={`status-rigmode-${entry.mode}`}
              disabled={reason !== null}
            >
              <span className="text-ui">{entry.short}</span>
            </ToggleGroupItem>
          </Tip>
        );
      })}
    </ToggleGroup>
  );
}

const VIEWS: readonly { readonly view: PoseView; readonly label: string; readonly text: string }[] = [
  { view: 'bind', label: 'Bind', text: 'Go to Bind Pose (the rest pose)' },
  { view: 'test', label: 'Test', text: 'Test pose (never keyed)' },
];
const VIEW_POLLS = VIEWS.map((entry) => ['rig.pose.view', { view: entry.view }] as const);

export function PoseViewBody(props: StatusGroupProps): JSX.Element {
  const view = useSession((s) => s.rig.poseView);
  const reasons = useReasons(props.app, VIEW_POLLS);
  return (
    <>
      <span className="text-ui-dense text-fg-3">Pose</span>
      <ToggleGroup
        type="single"
        value={view}
        aria-label="Pose view"
        onValueChange={(value) => {
          if (value !== '') props.run('rig.pose.view', { view: value });
        }}
      >
        {VIEWS.map((entry, i) => {
          const reason = reasons[i] ?? null;
          return (
            <Tip key={entry.view} text={reason === null ? entry.text : `${entry.text} (${reason})`}>
              <ToggleGroupItem
                value={entry.view}
                aria-label={entry.text}
                data-testid={`status-poseview-${entry.view}`}
                disabled={reason !== null && entry.view !== view}
              >
                <span className="text-ui">{entry.label}</span>
              </ToggleGroupItem>
            </Tip>
          );
        })}
      </ToggleGroup>
    </>
  );
}

/** The active character's skeleton (id and symmetry), or null. */
function useSkeleton(): { readonly id: string; readonly symmetry: boolean } | null {
  const character = useSession((s) => s.rig.character);
  return useDocQuery(
    (store) => {
      const skeleton = character === null ? undefined : store.query.skeletonOfCharacter(character);
      return skeleton === undefined ? null : { id: skeleton.id, symmetry: skeleton.symmetry };
    },
    ['skeletons'],
  );
}

const notSkin = (s: { readonly rig: RigSessionState }): boolean => s.rig.mode !== 'skin';

export function RigSymmetryBody(props: StatusGroupProps): JSX.Element | null {
  const shown = useSession(notSkin);
  const skeleton = useSkeleton();
  const [reason] = useReasons(props.app, [
    ['skel.symmetry.set', skeleton === null ? undefined : { skeleton: skeleton.id, on: !skeleton.symmetry }],
  ]);
  if (!shown) return null;
  const why = skeleton === null ? 'No skeleton yet' : (reason ?? null);
  return (
    <Tip text={why === null ? 'Joint symmetry across X' : `Joint symmetry across X (${why})`}>
      <Toggle
        pressed={skeleton?.symmetry ?? false}
        aria-label="Joint symmetry X"
        data-testid="status-rigsym"
        disabled={why !== null}
        onPressedChange={(on) => {
          if (skeleton !== null) props.run('skel.symmetry.set', { skeleton: skeleton.id, on });
        }}
      >
        <span className="text-ui">Sym X {skeleton?.symmetry === true ? '✓' : ''}</span>
      </Toggle>
    </Tip>
  );
}

export function RigSnapBody(props: StatusGroupProps): JSX.Element | null {
  const shown = useSession(notSkin);
  const center = useSession((s) => s.rig.snap.projectedCenter);
  if (!shown) return null;
  return (
    <Tip text="Snap joints to the projected centre of the mesh">
      <Toggle
        pressed={center}
        aria-label="Snap to projected centre"
        data-testid="status-rigsnap-center"
        onPressedChange={(on) => {
          const rig = props.app.session.getState().rig;
          props.app.session.setState({ rig: { ...rig, snap: { ...rig.snap, projectedCenter: on } } });
        }}
      >
        <span className="text-ui">◎ Ctr</span>
      </Toggle>
    </Tip>
  );
}

const JOINT_SIZE_STEP = 0.25;
const JOINT_SIZE_MIN = 0.25;
const JOINT_SIZE_MAX = 4;

/** The active pane's joint display flag (the status line edits the pane the view operators act on). */
function useJointFlags(app: EditorApp): { readonly xray: boolean; readonly axes: string } {
  // Read on every session change (hover moves the active pane); cheap.
  return useSession(
    () => {
      const port = paneDisplayPort(app);
      const pane = port?.activePane() ?? null;
      const display = pane === null ? null : (port?.display(pane) ?? null);
      return { xray: display?.xrayJoints ?? false, axes: display?.jointAxes ?? 'none' };
    },
    (a, b) => a.xray === b.xray && a.axes === b.axes,
  );
}

export function JointDisplayBody(props: StatusGroupProps): JSX.Element | null {
  const shown = useSession(notSkin);
  const size = usePrefs((p) => p.rigging.jointSize);
  const flags = useJointFlags(props.app);
  if (!shown) return null;
  const setSize = (next: number): void => {
    const rigging = props.app.prefs.getState().rigging;
    const jointSize = Math.min(JOINT_SIZE_MAX, Math.max(JOINT_SIZE_MIN, next));
    props.run('prefs.set', { patch: { rigging: { ...rigging, jointSize } } });
  };
  return (
    <>
      <span className="text-ui-dense text-fg-3">Joint</span>
      <Tip text="Smaller joints">
        <Toggle
          pressed={false}
          aria-label="Smaller joints"
          data-testid="status-jointsize-down"
          onPressedChange={() => setSize(size - JOINT_SIZE_STEP)}
        >
          <span className="text-ui">⊖</span>
        </Toggle>
      </Tip>
      <Tip text="Larger joints">
        <Toggle
          pressed={false}
          aria-label="Larger joints"
          data-testid="status-jointsize-up"
          onPressedChange={() => setSize(size + JOINT_SIZE_STEP)}
        >
          <span className="text-ui">⊕</span>
        </Toggle>
      </Tip>
      <Tip text={`X-ray joints${hint(props.app, 'view.display.toggle', { flag: 'xrayJoints' })}`}>
        <Toggle
          pressed={flags.xray}
          aria-label="X-ray joints"
          data-testid="status-joint-xray"
          onPressedChange={() => props.run('view.display.toggle', { flag: 'xrayJoints' })}
        >
          <span className="text-ui">◌ Xray</span>
        </Toggle>
      </Tip>
      <Tip text="Local rotation axes on the selected joints">
        <Toggle
          pressed={flags.axes !== 'none'}
          aria-label="Local rotation axes"
          data-testid="status-joint-axes"
          onPressedChange={(on) => props.run('view.display.set', { patch: { jointAxes: on ? 'selected' : 'none' } })}
        >
          <span className="text-ui">⊹ Axes</span>
        </Toggle>
      </Tip>
    </>
  );
}

/** Registers the Rig & Skin status-line bodies; the disposer removes them. */
export function registerRigStatusGroups(): Disposer {
  const disposers = [
    registerStatusGroup('rigMode', RigModeBody),
    registerStatusGroup('poseView', PoseViewBody),
    registerStatusGroup('rigSymmetry', RigSymmetryBody),
    registerStatusGroup('rigSnap', RigSnapBody),
    registerStatusGroup('jointDisplay', JointDisplayBody),
  ];
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
