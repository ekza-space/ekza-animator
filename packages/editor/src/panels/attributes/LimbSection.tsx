// The Attributes panel's Limb section (M2A-SPEC §5.6, §5.2.3, §5.7, A2): for the lead control's limb (its FK chain,
// IK control or pole) the IK/FK segmented buttons (a switch with match), Match FK to IK / Match IK to FK, the switch
// key mode (`prefs.ikFkSwitchKey`), and for legs the foot-roll pivot fields (cm; the break angle in degrees) that run
// `rig.setFootParams`; on a humanoid rig without limb IK, the "Add Limb IK" button (`rig.addLimbIk`).
import type { CharacterId, ControlId, ControlRecord, DocumentStore } from '@ekza-studio/doc';
import {
  type EditorApp,
  type IkFkKeyMode,
  LIMB_NAME,
  limbOfControlApp,
  PANEL,
  type Prefs,
} from '@ekza-studio/editor-core';
import type { FootRollParams, LimbDesc, LimbId } from '@ekza-studio/rig';
import { type JSX, useCallback, useId, useMemo, useSyncExternalStore } from 'react';
import { useDocQuery, usePrefs } from '../../hooks';
import { NumberField } from '../channels/kit/fields';
import { useCharactersVersion } from '../channels/kit/hooks';
import { formatFixed } from '../channels/kit/kernel';
import { runOperator } from '../channels/kit/run';
import { BUTTON, MUTED_TEXT, SELECT } from '../channels/kit/styles';
import { Field, Fields, Section } from './layout';

const PANEL_KIND = PANEL.attributes;

const KEY_MODES: readonly { readonly value: IkFkKeyMode; readonly label: string; readonly title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Seamless when IK/FK is keyed or auto-key is on, else no keys' },
  { value: 'none', label: 'No keys', title: 'Switch without keys (auto-key rules)' },
  { value: 'key', label: 'Key', title: 'Key the matched controls and IK/FK at this frame' },
  { value: 'seamless', label: 'Seamless', title: 'Also key IK/FK on the previous frame, so the pose never pops' },
];

/** Foot fields (§5.2.3): distances in cm, the break angle in degrees. */
const FOOT_FIELDS: readonly {
  readonly field: 'heelBack' | 'ballFront' | 'toeFront' | 'innerWidth' | 'outerWidth' | 'breakAngle';
  readonly label: string;
  readonly angle: boolean;
}[] = [
  { field: 'heelBack', label: 'Heel back (cm)', angle: false },
  { field: 'ballFront', label: 'Ball front (cm)', angle: false },
  { field: 'toeFront', label: 'Toe front (cm)', angle: false },
  { field: 'innerWidth', label: 'Inner width (cm)', angle: false },
  { field: 'outerWidth', label: 'Outer width (cm)', angle: false },
  { field: 'breakAngle', label: 'Break angle (°)', angle: true },
];

const selectKeyMode = (prefs: Prefs): IkFkKeyMode => prefs.ikFkSwitchKey;

/** Whether the control's rig is a humanoid auto-rig with no `ik2` solver record (Add Limb IK applies). */
function rigWithoutLimbIk(store: DocumentStore, control: ControlRecord | null): CharacterId | null {
  if (control === null) return null;
  const rig = store.get('rigs', control.rig);
  if (rig === undefined || rig.generator.name !== 'ekza-autorig-humanoid') return null;
  const hasIk = store.list('solvers').some((solver) => solver.rig === rig.id && solver.type === 'ik2');
  return hasIk ? null : rig.character;
}

function characterOfControl(app: EditorApp, control: ControlId): CharacterId | null {
  const record = app.store.get('controls', control);
  return record === undefined ? null : (app.store.get('rigs', record.rig)?.character ?? null);
}

type LimbMode = 'ik' | 'fk' | 'blend';

/**
 * What the section shows of a limb's evaluated `ikFk`, packed in one number so the per-pose read allocates nothing:
 * the value at 3 decimals (thousandths) × 4 + the mode (0 FK at ≤ 0.001, 1 blend, 2 IK at ≥ 0.999, §5.5 rule 2).
 */
function limbDisplayCode(app: EditorApp, character: CharacterId | null, limb: LimbId): number {
  const w = character === null ? 0 : (app.evaluation.ikFk(character, limb) ?? 0);
  return Math.round(w * 1000) * 4 + (w >= 0.999 ? 2 : w <= 0.001 ? 0 : 1);
}

/**
 * The limb's IK/FK mode and value, read per evaluated pose through `useSyncExternalStore` with a primitive snapshot:
 * the section commits only when what it shows changes, never per frame during playback (§5.5 rule 5, MVP-SPEC WP-9
 * "no per-frame React renders"), also while the Attributes tab is mounted but hidden.
 */
function useLimbDisplay(
  app: EditorApp,
  character: CharacterId | null,
  limb: LimbId,
): { readonly mode: LimbMode; readonly w: number } {
  const subscribe = useCallback(
    (notify: () => void) => {
      // Evaluated poses, plus what changes the value before the next evaluation (time, overrides, the active clip,
      // the curves, recompiled rigs): each only re-reads the snapshot.
      const disposers = [
        app.evaluation.subscribe(() => notify()),
        app.characters.subscribe(() => notify()),
        app.store.subscribe(() => notify()),
        app.session.subscribe((state, previous) => {
          if (
            state.time !== previous.time ||
            state.overrides !== previous.overrides ||
            state.activeClip !== previous.activeClip
          ) {
            notify();
          }
        }),
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    },
    [app],
  );
  const read = useCallback(() => limbDisplayCode(app, character, limb), [app, character, limb]);
  const code = useSyncExternalStore(subscribe, read, read);
  const mode = code % 4;
  return { mode: mode === 2 ? 'ik' : mode === 0 ? 'fk' : 'blend', w: Math.floor(code / 4) / 1000 };
}

export function LimbSection(props: {
  readonly app: EditorApp;
  readonly control: ControlRecord | null;
}): JSX.Element | null {
  const { app, control } = props;
  const characters = useCharactersVersion(app);
  const limb = useMemo(() => {
    void characters; // recompiled programs carry new limbs
    return control === null ? null : limbOfControlApp(app, control.id);
  }, [app, control, characters]);
  const readRig = useCallback((store: DocumentStore) => rigWithoutLimbIk(store, control), [control]);
  const addFor = useDocQuery(readRig, ['rigs', 'solvers']);
  if (limb !== null) return <LimbFields app={app} limb={limb} />;
  if (addFor === null) return null;
  const poll = app.operators.poll('rig.addLimbIk', { panel: PANEL_KIND }, { character: addFor });
  return (
    <Section title="Limb" testId="attr-section-limb">
      <p className={`mb-2 ${MUTED_TEXT}`}>This rig has FK limbs only. IK controls keep your animation unchanged.</p>
      <button
        type="button"
        className={BUTTON}
        disabled={poll !== true}
        title={poll === true ? 'Add IK controls to every limb (they start in FK)' : poll.reason}
        data-testid="attr-add-limb-ik"
        onClick={() => void runOperator(app, PANEL_KIND, 'rig.addLimbIk', { character: addFor })}
      >
        Add Limb IK
      </button>
    </Section>
  );
}

function LimbFields(props: { readonly app: EditorApp; readonly limb: LimbDesc }): JSX.Element {
  const { app, limb } = props;
  const id = useId();
  const keyMode = usePrefs(selectKeyMode);
  const character = useMemo(() => characterOfControl(app, limb.params.ikControl), [app, limb]);
  const { mode, w } = useLimbDisplay(app, character, limb.id);
  const name = LIMB_NAME[limb.id];
  const switchTo = (to: 'ik' | 'fk'): void =>
    void runOperator(app, PANEL_KIND, 'rig.ikFk.switch', { limb: limb.id, to, match: true });
  const match = (side: 'ik' | 'fk'): void =>
    void runOperator(app, PANEL_KIND, 'rig.ikFk.match', { limb: limb.id, side });
  const segment = (to: 'ik' | 'fk'): JSX.Element => (
    <button
      type="button"
      className={`${BUTTON} ${mode === to ? 'bg-[var(--bg-selected,#3b3270)] text-fg' : ''}`}
      aria-pressed={mode === to}
      title={
        mode === to ? `${name} is ${to.toUpperCase()}` : `Switch ${name} to ${to.toUpperCase()} (matches the pose)`
      }
      data-testid={`attr-limb-mode-${to}-${limb.id}`}
      // The pressed segment is the limb's mode: a switch to it would re-match the visible side and move the pose
      // (§5.6), so its click does nothing (`rig.ikFk.switch` refuses it too).
      onClick={mode === to ? undefined : () => switchTo(to)}
    >
      {to.toUpperCase()}
    </button>
  );
  return (
    <Section title={`Limb · ${name}`} testId="attr-section-limb">
      <div data-testid={`attr-limb-${limb.id}`} data-mode={mode}>
        <Fields>
          <Field label="IK/FK">
            <span className="flex items-center gap-1">
              <fieldset aria-label={`${name} mode`} className="m-0 flex gap-0.5 border-0 p-0">
                {segment('ik')}
                {segment('fk')}
              </fieldset>
              <span className={`tabular-nums ${MUTED_TEXT}`} title="ikFk: 0 = FK, 1 = IK">
                {formatFixed(w, 3)}
              </span>
            </span>
          </Field>
          <Field label="Match">
            <span className="flex flex-wrap gap-1">
              <button
                type="button"
                className={BUTTON}
                title="Set the FK controls from the IK pose at this frame"
                data-testid={`attr-limb-match-fk-${limb.id}`}
                onClick={() => match('fk')}
              >
                FK to IK
              </button>
              <button
                type="button"
                className={BUTTON}
                title="Set the IK control and pole from the FK pose at this frame"
                data-testid={`attr-limb-match-ik-${limb.id}`}
                onClick={() => match('ik')}
              >
                IK to FK
              </button>
            </span>
          </Field>
          <Field label="Switch keys" htmlFor={`${id}-keys`}>
            <select
              id={`${id}-keys`}
              className={`${SELECT} w-28`}
              value={keyMode}
              title={KEY_MODES.find((entry) => entry.value === keyMode)?.title}
              data-testid="attr-limb-key-mode"
              onChange={(event) =>
                void runOperator(app, PANEL_KIND, 'prefs.set', {
                  patch: { ikFkSwitchKey: event.currentTarget.value as IkFkKeyMode },
                })
              }
            >
              {KEY_MODES.map((entry) => (
                <option key={entry.value} value={entry.value} title={entry.title}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          {limb.params.foot === null ? null : <FootFields app={app} limb={limb} foot={limb.params.foot} />}
        </Fields>
      </div>
    </Section>
  );
}

function FootFields(props: {
  readonly app: EditorApp;
  readonly limb: LimbDesc;
  readonly foot: FootRollParams;
}): JSX.Element {
  const { app, limb, foot } = props;
  const id = useId();
  return (
    <>
      {FOOT_FIELDS.map(({ field, label, angle }) => (
        <Field key={field} label={label} htmlFor={`${id}-${field}`}>
          <NumberField
            id={`${id}-${field}`}
            className="w-24 text-right tabular-nums"
            ariaLabel={`${LIMB_NAME[limb.id]} ${label}`}
            testId={`attr-limb-foot-${limb.id}-${field}`}
            value={angle ? (foot[field] * 180) / Math.PI : foot[field] * 100}
            format={(value) => formatFixed(value, angle ? 1 : 2)}
            validate={(value) => (value < 0 ? 'Must be 0 or more' : angle && value > 90 ? 'At most 90°' : null)}
            onValue={(value) =>
              void runOperator(app, PANEL_KIND, 'rig.setFootParams', {
                limb: limb.id as 'leg.L' | 'leg.R',
                params: { [field]: angle ? (value * Math.PI) / 180 : value / 100 },
              })
            }
          />
        </Field>
      ))}
    </>
  );
}
