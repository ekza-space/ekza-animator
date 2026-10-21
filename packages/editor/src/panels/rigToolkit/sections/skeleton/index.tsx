// The Rig Toolkit's Skeleton section (M6B-SPEC §8.6, §0.3 C3, §0.4.3; C3). While Quick Rig runs it shows the Quick Rig
// panel body; otherwise Quick Rig…, the template (Skeleton Template on the selected meshes), Orient Joints and Mirror
// Joints with their option boxes `⋯` (the shared option box, generated from the operators' params), the symmetry and
// Snap to Projected Center toggles, and the selected joint's fields: name (rename), human bone (Map Humanoid Bone) and
// rest position (Set Rest). Buttons run operators with `source: 'toolkit'`; a disabled button shows the poll reason.
import type { DocumentStore, HumanBoneName, JointRecord, SkeletonRecord } from '@ekza-studio/doc';
import { type EditorApp, PANEL, type RunContext } from '@ekza-studio/editor-core';
import { HUMAN_BONE_NAMES, type SkeletonPreset, VRM_REQUIRED_BONES } from '@ekza-studio/rig';
import { type JSX, useState } from 'react';
import { useDocQuery, useRunOperator, useSession } from '../../../../hooks';
import { openOptionBox } from '../../../../overlays/menus/optionBox';
import { useReasons } from '../../../../shell/rig/hooks';
import { PRESET_LABELS, QUICK_RIG_BUTTON, QuickRigPanelBody } from '../../../quickRig/body';
import type { RigToolkitSectionProps } from '../types';

const CTX: RunContext = { panel: PANEL.rigToolkit, source: 'toolkit' };
const FIELD =
  'h-6 min-w-0 rounded-[4px] border border-line bg-[var(--bg-field,#17181b)] px-1 text-[11px] text-fg disabled:opacity-50';

interface SkeletonInfo {
  readonly skeleton: SkeletonRecord;
  readonly joints: readonly JointRecord[];
  readonly required: number;
}

function skeletonInfo(store: DocumentStore, character: string | null): SkeletonInfo | null {
  if (character === null) return null;
  const skeleton = store.query.skeletonOfCharacter(character as never);
  if (skeleton === undefined) return null;
  const joints = store.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null);
  const present = new Set(joints.map((joint) => joint.humanBone));
  const required = VRM_REQUIRED_BONES.filter((bone) => present.has(bone)).length;
  return { skeleton, joints, required };
}

function Op(props: {
  readonly app: EditorApp;
  readonly op: string;
  readonly args?: unknown;
  readonly label: string;
  readonly options?: boolean;
}): JSX.Element {
  const run = useRunOperator();
  const [reason] = useReasons(props.app, [[props.op, props.args]]);
  return (
    <span className="inline-flex">
      <button
        type="button"
        className={QUICK_RIG_BUTTON}
        disabled={reason !== null}
        title={reason ?? undefined}
        data-testid={`rtk-btn-${props.op}`}
        onClick={() => void run(props.op, props.args, CTX)}
      >
        {props.label}
      </button>
      {props.options === true ? (
        <button
          type="button"
          className={`${QUICK_RIG_BUTTON} ml-px px-1`}
          aria-label={`${props.label} options`}
          data-testid={`rtk-opt-${props.op}`}
          onClick={(event) => {
            const r = event.currentTarget.getBoundingClientRect();
            openOptionBox(props.app, props.op, { x: r.left - 300, y: r.top });
          }}
        >
          ⋯
        </button>
      ) : null}
    </span>
  );
}

/** A number field that runs its change on Enter or blur. */
function NumberField(props: {
  readonly value: number;
  readonly label: string;
  readonly testId: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? props.value.toFixed(4);
  const commit = (): void => {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (Number.isFinite(value) && value !== props.value) props.onCommit(value);
  };
  return (
    <input
      className={`${FIELD} w-16`}
      aria-label={props.label}
      inputMode="decimal"
      value={shown}
      data-testid={props.testId}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function JointFields(props: { readonly joint: JointRecord }): JSX.Element {
  const { joint } = props;
  const run = useRunOperator();
  const [name, setName] = useState<string | null>(null);
  const rest = joint.restPosition;
  const setRest = (k: 0 | 1 | 2, value: number): void => {
    const position: [number, number, number] = [rest[0], rest[1], rest[2]];
    position[k] = value;
    void run('skel.joint.setRest', { joint: joint.id, position }, CTX);
  };
  const commitName = (): void => {
    if (name === null) return;
    const next = name.trim();
    setName(null);
    if (next !== '' && next !== joint.name) void run('skel.joint.rename', { joint: joint.id, name: next }, CTX);
  };
  return (
    <div className="flex flex-col gap-1" data-testid="rtk-joint">
      <label className="flex items-center justify-between gap-2">
        <span>Name</span>
        <input
          className={`${FIELD} w-36`}
          value={name ?? joint.name}
          data-testid="attr-joint-name"
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitName();
            if (event.key === 'Escape') setName(null);
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Human bone</span>
        <select
          className={`${FIELD} w-36`}
          value={joint.humanBone ?? ''}
          data-testid="attr-joint-humanBone"
          onChange={(event) =>
            void run(
              'skel.joint.setHumanBone',
              { joint: joint.id, bone: event.target.value === '' ? null : (event.target.value as HumanBoneName) },
              CTX,
            )
          }
        >
          <option value="">None</option>
          {HUMAN_BONE_NAMES.map((bone) => (
            <option key={bone} value={bone}>
              {bone}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-1">
        <span>Rest</span>
        <span className="flex gap-1">
          {(['X', 'Y', 'Z'] as const).map((axis, k) => (
            <NumberField
              key={axis}
              label={`Rest ${axis}`}
              value={rest[k] as number}
              testId={`attr-joint-rest${axis}`}
              onCommit={(value) => setRest(k as 0 | 1 | 2, value)}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export function SkeletonSection(props: RigToolkitSectionProps): JSX.Element | null {
  const { app } = props;
  const run = useRunOperator();
  const quickRig = useSession((s) => s.rig.quickRig !== null);
  const character = useSession((s) => s.rig.character);
  const lead = useSession((s) => s.selection.joints.at(-1) ?? null);
  const snap = useSession((s) => s.rig.snap.projectedCenter);
  const objects = useSession((s) => s.selection.objects);
  const info = useDocQuery((store) => skeletonInfo(store, character), ['skeletons', 'joints', 'characters']);
  const [preset, setPreset] = useState<SkeletonPreset>('standard33');
  if (quickRig) return <QuickRigPanelBody app={app} compact />;
  const joint: JointRecord | undefined =
    lead === null ? undefined : info?.joints.find((candidate) => candidate.id === lead);
  return (
    <div className="flex flex-col gap-1.5" data-testid="rtk-skeleton">
      {info === null ? null : (
        <p className="text-[11px] text-fg-3" data-testid="rtk-skeleton-count">
          {PRESET_LABELS[info.skeleton.preset as SkeletonPreset] ?? info.skeleton.preset} · {info.joints.length} joints
          · {info.required}/{VRM_REQUIRED_BONES.length} required
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Op app={app} op="skel.quickRig.start" label="Quick Rig…" />
        {info === null ? (
          <span className="inline-flex gap-px">
            <select
              className={FIELD}
              aria-label="Template"
              value={preset}
              data-testid="rtk-skel-template"
              onChange={(event) => setPreset(event.target.value as SkeletonPreset)}
            >
              {(Object.keys(PRESET_LABELS) as SkeletonPreset[]).map((key) => (
                <option key={key} value={key}>
                  {PRESET_LABELS[key]}
                </option>
              ))}
            </select>
            <Op app={app} op="skel.template.create" args={{ preset, objects }} label="Skeleton Template" />
          </span>
        ) : null}
      </div>
      {info === null ? null : (
        <>
          <div className="flex flex-wrap gap-1">
            <Op app={app} op="skel.joint.orient" label="Orient Joints" options />
            <Op app={app} op="skel.joint.mirror" label="Mirror Joints" options />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={info.skeleton.symmetry}
              data-testid="rtk-skel-symmetry"
              onChange={(event) =>
                void run('skel.symmetry.set', { skeleton: info.skeleton.id, on: event.target.checked }, CTX)
              }
            />
            <span>Symmetry X</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={snap}
              data-testid="rtk-skel-snap"
              onChange={(event) => void run('rig.snap.projectedCenter', { on: event.target.checked }, CTX)}
            />
            <span>Snap to Projected Center</span>
          </label>
          {joint === undefined ? (
            <p className="text-[11px] text-fg-3" data-testid="rtk-joint-none">
              Select a joint (`1` for Skeleton mode): `W` moves it with its children, hold `D` to move it alone.
            </p>
          ) : (
            <JointFields key={joint.id} joint={joint} />
          )}
        </>
      )}
    </div>
  );
}
