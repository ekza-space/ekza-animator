// The Attributes panel's Model sections (M6A-SPEC §8.8, §5.16, §5.19, §5.22, §5.26; B13; lazy chunk):
// - Mesh (`attr-mesh-<field>`): name, faceted, material preset, colour output, budget preset or triangle target of the
//   lead selected mesh (`mesh.setAttributes`; renames keep the generator); a group shows its name and budget;
// - Primitive (`attr-prim-<param>`) while the mesh's parameters are live (`mesh.primitive.set`, one step each);
// - Pivot (`attr-pivot-<x|y|z>`, object space; `mesh.pivot.set`);
// - Handheld grip (`attr-grip-<field>`) on a handheld root (bone, offset, rotation in degrees, scale);
// - Image plane (`attr-plane-<field>`) for the plane selected in the Outliner: name, camera, offset ("x, y" metres),
//   size, opacity, depth, lock, visible; a locked plane takes only its lock and visibility.
import type { ParamDef } from '@ekza-studio/anim-core';
import type {
  DocumentStore,
  GroupRecord,
  HandheldGrip,
  ImagePlaneRecord,
  MeshBudget,
  MeshId,
  MeshRecord,
} from '@ekza-studio/doc';
import { BUDGET_PRESETS, type EditorApp, type SessionState, TOON_REASON } from '@ekza-studio/editor-core';
import { PRIMITIVE_PARAMS } from '@ekza-studio/mesh-core/descriptors';
import { type JSX, useCallback, useId, useState } from 'react';
import { useDocQuery, useRunOperator, useSession } from '../../hooks';
import { NumberField } from '../channels/kit/fields';
import { formatFixed } from '../channels/kit/kernel';
import { CHECK, INPUT, INVALID, MUTED_TEXT, SELECT } from '../channels/kit/styles';
import { useSelectedPlane } from '../outliner/planeSelection';
import { Field, Fields, Section } from './layout';

const PANEL_KIND = 'attributes';

type Run = ReturnType<typeof useRunOperator>;
type SceneObject = MeshRecord | GroupRecord;

const selectLead = (s: SessionState): string | null => s.selection.objects.at(-1) ?? null;

const BUDGET_LABEL: Readonly<Record<string, string>> = {
  hero: 'Hero',
  npc: 'NPC',
  boss: 'Boss',
  handheld: 'Handheld',
  'small-prop': 'Small prop',
  'medium-prop': 'Medium prop',
  building: 'Building',
};
const OUTPUT_LABEL = {
  'palette-texture': 'Palette texture',
  'vertex-colour': 'Vertex colours',
  'material-per-colour': 'One material per colour',
} as const;
const CAMERAS = ['front', 'side', 'top'] as const;

interface View {
  readonly object: SceneObject | null;
  readonly plane: ImagePlaneRecord | null;
}

export default function ModelSections(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const run = useRunOperator();
  const lead = useSession(selectLead);
  const planeId = useSelectedPlane(app);
  const read = useCallback(
    (store: DocumentStore): View => ({
      object:
        lead === null
          ? null
          : lead.startsWith('grp_')
            ? (store.get('groups', lead as never) ?? null)
            : (store.get('meshes', lead as MeshId) ?? null),
      plane: planeId === null ? null : (store.get('imagePlanes', planeId) ?? null),
    }),
    [lead, planeId],
  );
  const view = useDocQuery(read, ['meshes', 'groups', 'imagePlanes']);
  const object = view.object;
  const mesh = object !== null && object.id.startsWith('msh_') ? (object as MeshRecord) : null;
  return (
    <div data-testid="attr-model">
      {view.plane === null ? null : <PlaneSection key={`plane:${view.plane.id}`} plane={view.plane} run={run} />}
      <Section title={mesh === null && object !== null ? 'Group' : 'Mesh'} testId="attr-section-mesh">
        {object === null ? (
          <p className={MUTED_TEXT}>
            {view.plane === null ? 'Select a mesh or group.' : 'An image plane is selected.'}
          </p>
        ) : (
          <ObjectFields key={`fields:${object.id}`} object={object} run={run} />
        )}
      </Section>
      {mesh !== null && mesh.generator !== null ? (
        <PrimitiveSection key={`prim:${mesh.id}:${mesh.generator.kind}`} mesh={mesh} run={run} />
      ) : null}
      {object === null ? null : <PivotSection key={`pivot:${object.id}`} object={object} run={run} />}
      {object !== null && object.handheld !== null ? (
        <GripSection key={`grip:${object.id}`} object={object} grip={object.handheld} run={run} />
      ) : null}
    </div>
  );
}

// ---------- Mesh / Group ----------

function TextField(props: {
  readonly value: string;
  readonly testId: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onCommit: (text: string) => string | null;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const problem = draft.trim() === props.value ? null : props.onCommit(draft);
    setError(problem);
    if (problem === null) setDraft(null);
  };
  return (
    <input
      type="text"
      className={`${INPUT} w-full ${error === null ? '' : INVALID}`}
      value={draft ?? props.value}
      aria-label={props.label}
      aria-invalid={error !== null}
      title={error ?? undefined}
      disabled={props.disabled}
      spellCheck={false}
      data-testid={props.testId}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape') {
          setDraft(null);
          setError(null);
        }
      }}
    />
  );
}

function budgetValue(budget: MeshBudget): string {
  if (budget === null) return '';
  return 'preset' in budget ? budget.preset : 'custom';
}

function ObjectFields(props: { readonly object: SceneObject; readonly run: Run }): JSX.Element {
  const { object, run } = props;
  const ids = useId();
  const isMesh = object.id.startsWith('msh_');
  const mesh = isMesh ? (object as MeshRecord) : null;
  const imported = mesh !== null && mesh.source !== null;
  const set = (patch: Record<string, unknown>): void =>
    void run('mesh.setAttributes', { mesh: object.id, patch }, { panel: PANEL_KIND });
  const budget = budgetValue(object.budget);
  return (
    <Fields>
      <Field label="Name" htmlFor={`${ids}-name`}>
        <TextField
          value={object.name}
          label="Name"
          testId="attr-mesh-name"
          onCommit={(text) => {
            if (text.trim() === '') return 'The name must not be empty';
            void run('scene.rename', { id: object.id, name: text }, { panel: PANEL_KIND });
            return null;
          }}
        />
      </Field>
      {mesh === null ? null : (
        <>
          <Field label="Faceted">
            <input
              type="checkbox"
              className={CHECK}
              checked={mesh.faceted}
              aria-label="Faceted"
              data-testid="attr-mesh-faceted"
              onChange={(event) => set({ faceted: event.currentTarget.checked })}
            />
          </Field>
          <Field label="Material" htmlFor={`${ids}-material`}>
            <select
              id={`${ids}-material`}
              className={`${SELECT} w-full`}
              value={'preset' in mesh.material ? mesh.material.preset : 'asset'}
              disabled={imported}
              title={imported ? 'Imported meshes keep their materials' : undefined}
              data-testid="attr-mesh-material"
              onChange={(event) => set({ material: { preset: event.currentTarget.value } })}
            >
              {'preset' in mesh.material ? null : <option value="asset">The asset's materials</option>}
              <option value="unlit">Unlit (flat colours)</option>
              <option value="lit">Lit</option>
              <option value="toon" disabled title={TOON_REASON}>
                Toon — arrives with the VRM writer
              </option>
            </select>
          </Field>
          <Field label="Colour output" htmlFor={`${ids}-output`}>
            <select
              id={`${ids}-output`}
              className={`${SELECT} w-full`}
              value={mesh.colourOutput}
              disabled={imported}
              data-testid="attr-mesh-colourOutput"
              onChange={(event) => set({ colourOutput: event.currentTarget.value })}
            >
              {Object.entries(OUTPUT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label="Budget" htmlFor={`${ids}-budget`}>
        <select
          id={`${ids}-budget`}
          className={`${SELECT} w-full`}
          value={budget}
          data-testid="attr-mesh-budget"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === '') set({ budget: null });
            else if (value === 'custom')
              set({
                budget: { tris: 'tris' in (object.budget ?? {}) ? (object.budget as { tris: number }).tris : 1000 },
              });
            else set({ budget: { preset: value } });
          }}
        >
          <option value="">Export profile default</option>
          {BUDGET_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {BUDGET_LABEL[preset] ?? preset}
            </option>
          ))}
          <option value="custom">Custom triangle target</option>
        </select>
      </Field>
      {object.budget !== null && 'tris' in object.budget ? (
        <Field label="Target tris">
          <NumberField
            value={object.budget.tris}
            ariaLabel="Triangle target"
            testId="attr-mesh-budgetTris"
            format={(v) => String(Math.round(v))}
            validate={(v) => (Number.isInteger(Math.round(v)) && v >= 1 ? null : 'A whole number ≥ 1')}
            onValue={(v) => set({ budget: { tris: Math.round(v) } })}
          />
        </Field>
      ) : null}
      {mesh !== null && mesh.source !== null ? (
        <Field label="Source">
          <span className={MUTED_TEXT}>glTF mesh {mesh.source.mesh} (made editable)</span>
        </Field>
      ) : null}
      {object.id.startsWith('grp_') && (object as GroupRecord).template !== null ? (
        <Field label="Template">
          <span className="text-fg-2" data-testid="attr-group-template">
            {(object as GroupRecord).template?.kind}
          </span>
        </Field>
      ) : null}
    </Fields>
  );
}

// ---------- Primitive ----------

function paramField(param: ParamDef, value: unknown, onValue: (value: number | string) => void): JSX.Element {
  const testId = `attr-prim-${param.name}`;
  if (param.kind === 'enum') {
    return (
      <select
        className={`${SELECT} w-full`}
        value={String(value)}
        aria-label={param.label}
        data-testid={testId}
        onChange={(event) => onValue(event.currentTarget.value)}
      >
        {(param.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const int = param.kind === 'int';
  return (
    <NumberField
      value={typeof value === 'number' ? value : Number(param.default)}
      ariaLabel={param.label}
      testId={testId}
      format={(v) => (int ? String(Math.round(v)) : formatFixed(v, 3))}
      validate={(v) => {
        const n = int ? Math.round(v) : v;
        if (param.min !== undefined && n < param.min) return `${param.label}: at least ${param.min}`;
        if (param.max !== undefined && n > param.max) return `${param.label}: at most ${param.max}`;
        return null;
      }}
      onValue={(v) => onValue(int ? Math.round(v) : v)}
    />
  );
}

function PrimitiveSection(props: { readonly mesh: MeshRecord; readonly run: Run }): JSX.Element {
  const { mesh, run } = props;
  const generator = mesh.generator;
  if (generator === null) return <></>;
  const params = PRIMITIVE_PARAMS[generator.kind] ?? [];
  return (
    <Section title={`Primitive (${generator.kind})`} testId="attr-section-primitive">
      <Fields>
        {params
          .filter((param) => param.hidden !== true)
          .map((param) => (
            <Field key={param.name} label={param.label}>
              {paramField(param, generator.params[param.name] ?? param.default, (value) => {
                void run(
                  'mesh.primitive.set',
                  { mesh: mesh.id, params: { [param.name]: value } },
                  { panel: PANEL_KIND, source: 'card' },
                );
              })}
            </Field>
          ))}
      </Fields>
      <p className={`${MUTED_TEXT} mt-2`}>Live until the first component edit.</p>
    </Section>
  );
}

// ---------- Pivot ----------

function PivotSection(props: { readonly object: SceneObject; readonly run: Run }): JSX.Element {
  const { object, run } = props;
  const axes = ['x', 'y', 'z'] as const;
  return (
    <Section title="Pivot" testId="attr-section-pivot">
      <Fields>
        {axes.map((axis, i) => (
          <Field key={axis} label={`Pivot ${axis.toUpperCase()}`}>
            <NumberField
              value={object.pivot[i] as number}
              ariaLabel={`Pivot ${axis.toUpperCase()} (m, object space)`}
              testId={`attr-pivot-${axis}`}
              format={(v) => formatFixed(v, 3)}
              onValue={(v) => {
                const pivot = [...object.pivot] as [number, number, number];
                pivot[i] = v;
                void run('mesh.pivot.set', { id: object.id, pivot }, { panel: PANEL_KIND });
              }}
            />
          </Field>
        ))}
      </Fields>
    </Section>
  );
}

// ---------- Handheld grip ----------

function GripSection(props: {
  readonly object: SceneObject;
  readonly grip: HandheldGrip;
  readonly run: Run;
}): JSX.Element {
  const { object, grip, run } = props;
  const set = (patch: Partial<HandheldGrip>): void =>
    void run(
      'mesh.setAttributes',
      { mesh: object.id, patch: { handheld: { ...grip, ...patch } } },
      { panel: PANEL_KIND },
    );
  const vec = (key: 'offset' | 'rotationDegrees', label: string, field: string, unit: string): JSX.Element[] =>
    (['x', 'y', 'z'] as const).map((axis, i) => (
      <Field key={`${key}-${axis}`} label={`${label} ${axis.toUpperCase()}`}>
        <NumberField
          value={grip[key][i] as number}
          ariaLabel={`${label} ${axis.toUpperCase()} (${unit})`}
          testId={`attr-grip-${field}${axis.toUpperCase()}`}
          format={(v) => formatFixed(v, key === 'offset' ? 3 : 1)}
          onValue={(v) => {
            const next = [...grip[key]] as [number, number, number];
            next[i] = v;
            set({ [key]: next });
          }}
        />
      </Field>
    ));
  return (
    <Section title="Handheld grip" testId="attr-section-grip">
      <Fields>
        <Field label="Hand">
          <select
            className={`${SELECT} w-full`}
            value={grip.bone}
            aria-label="Hand"
            data-testid="attr-grip-bone"
            onChange={(event) => set({ bone: event.currentTarget.value === 'leftHand' ? 'leftHand' : 'rightHand' })}
          >
            <option value="rightHand">Right hand</option>
            <option value="leftHand">Left hand</option>
          </select>
        </Field>
        {vec('offset', 'Offset', 'offset', 'm, ±0.3')}
        {vec('rotationDegrees', 'Rotation', 'rotation', '°')}
        <Field label="Scale">
          <NumberField
            value={grip.scale}
            ariaLabel="Grip scale (0.25…2)"
            testId="attr-grip-scale"
            format={(v) => formatFixed(v, 2)}
            validate={(v) => (v >= 0.25 && v <= 2 ? null : 'Scale: 0.25…2')}
            onValue={(v) => set({ scale: v })}
          />
        </Field>
      </Fields>
      <p className={`${MUTED_TEXT} mt-2`}>
        The group origin is the grip: +Y runs along the shaft, +Z to the fingertips.
      </p>
    </Section>
  );
}

// ---------- Image plane ----------

/** "x, y" (comma or spaces) → two finite numbers, or null. */
export function parseOffset(text: string): [number, number] | null {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter((part) => part !== '');
  if (parts.length !== 2) return null;
  const values = parts.map(Number);
  return values.every((v) => Number.isFinite(v)) ? [values[0] as number, values[1] as number] : null;
}

function PlaneSection(props: { readonly plane: ImagePlaneRecord; readonly run: Run }): JSX.Element {
  const { plane, run } = props;
  const ids = useId();
  const set = (patch: Record<string, unknown>): void =>
    void run('imagePlane.set', { id: plane.id, patch }, { panel: PANEL_KIND });
  const locked = plane.locked;
  return (
    <Section title="Image plane" testId="attr-section-plane">
      <Fields>
        <Field label="Name">
          <TextField
            value={plane.name}
            label="Image plane name"
            testId="attr-plane-name"
            disabled={locked}
            onCommit={(text) => {
              if (text.trim() === '') return 'The name must not be empty';
              set({ name: text });
              return null;
            }}
          />
        </Field>
        <Field label="View" htmlFor={`${ids}-camera`}>
          <select
            id={`${ids}-camera`}
            className={`${SELECT} w-full`}
            value={plane.camera}
            disabled={locked}
            data-testid="attr-plane-camera"
            onChange={(event) => set({ camera: event.currentTarget.value })}
          >
            {CAMERAS.map((camera) => (
              <option key={camera} value={camera}>
                {camera.charAt(0).toUpperCase() + camera.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Offset">
          <TextField
            value={`${formatFixed(plane.offset[0], 3)}, ${formatFixed(plane.offset[1], 3)}`}
            label="Offset in the view plane (metres right, up)"
            testId="attr-plane-offset"
            disabled={locked}
            onCommit={(text) => {
              const offset = parseOffset(text);
              if (offset === null) return 'Type two numbers: right, up (metres)';
              set({ offset });
              return null;
            }}
          />
        </Field>
        <Field label="Size">
          <NumberField
            value={plane.size}
            ariaLabel="Height in metres"
            testId="attr-plane-size"
            readOnly={locked}
            format={(v) => formatFixed(v, 3)}
            validate={(v) => (v > 0 ? null : 'The size must be above 0 m')}
            onValue={(v) => set({ size: v })}
          />
        </Field>
        <Field label="Opacity">
          <NumberField
            value={plane.opacity}
            ariaLabel="Opacity (0…1)"
            testId="attr-plane-opacity"
            readOnly={locked}
            format={(v) => formatFixed(v, 2)}
            validate={(v) => (v >= 0 && v <= 1 ? null : 'Opacity: 0…1')}
            onValue={(v) => set({ opacity: v })}
          />
        </Field>
        <Field label="Depth" htmlFor={`${ids}-depth`}>
          <select
            id={`${ids}-depth`}
            className={`${SELECT} w-full`}
            value={plane.depth}
            disabled={locked}
            data-testid="attr-plane-depth"
            onChange={(event) => set({ depth: event.currentTarget.value })}
          >
            <option value="behind">Behind the model</option>
            <option value="front">In front of the model</option>
          </select>
        </Field>
        <Field label="Locked">
          <input
            type="checkbox"
            className={CHECK}
            checked={plane.locked}
            aria-label="Locked"
            data-testid="attr-plane-locked"
            onChange={(event) => set({ locked: event.currentTarget.checked })}
          />
        </Field>
        <Field label="Visible">
          <input
            type="checkbox"
            className={CHECK}
            checked={plane.visible}
            aria-label="Visible"
            data-testid="attr-plane-visible"
            onChange={(event) => set({ visible: event.currentTarget.checked })}
          />
        </Field>
      </Fields>
      <button
        type="button"
        className={`mt-2 text-fg-2 underline-offset-2 hover:text-fg hover:underline`}
        data-testid="attr-plane-delete"
        onClick={() => void run('imagePlane.delete', { id: plane.id }, { panel: PANEL_KIND })}
      >
        Delete image plane
      </button>
    </Section>
  );
}
