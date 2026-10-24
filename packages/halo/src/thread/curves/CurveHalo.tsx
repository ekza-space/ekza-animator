// The curve's Halo, docked in the Curves layer (STUDIO-TOUCH-SPEC §6.2 "Curve", §10.5; T10): the verb table's petals
// of the `curve` noun in slot order — *Ease all ▾*, *Fewer keys* (a pre-run form with its tolerance), *Fix flips*,
// *Cycle ▾* (pre and post together), *Insert key* (on the curve at the playhead) — and ⋯ More over the curve noun
// (Key curves here, Compare: snapshot · swap · clear, Weighted, View: Real · Fit · Stacked). Its subject is the tapped
// curve, else the curves of the selected keys (the operators' own rule), else every shown curve. A ▾ petal opens its
// choices in a row under it; each choice is one touch and one operator run.
import type { CurveId } from '@ekza-studio/doc';
import { type EditorApp, PANEL } from '@ekza-studio/editor-core';
import { TouchButton, VerbBar, type VerbItem } from '@ekza-studio/ui/touch';
import { type JSX, useState } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { PANE } from '../../shell/stage';
import { animateCharacter, type OpCall } from '../../stages/animate/model';
import { AnimateGlyph, type AnimateIcon } from '../../stages/animate/icons';
import { threadNoun } from '../../stages/animate/sheetContext';
import { petalsFor } from '../../verbs/table';
import { curveKeyItems } from './model';

const w = animateWords.curves;

const ICON: Readonly<Record<string, AnimateIcon>> = {
  easeAll: 'ease',
  fewerKeys: 'remove',
  fixFlips: 'repeat',
  cycle: 'repeat',
  insertKey: 'insert',
};

const LABEL: Readonly<Record<string, string>> = {
  easeAll: w.easeAll,
  fewerKeys: w.fewerKeys,
  fixFlips: w.fixFlips,
  cycle: w.cycle,
  insertKey: w.insertKey,
};

type Action =
  | { readonly calls: readonly OpCall[] }
  | { readonly menu: readonly { readonly label: string; readonly calls: readonly OpCall[] }[] }
  | { readonly form: OpCall };

function pollOf(app: EditorApp, call: OpCall | undefined): string | undefined {
  if (call === undefined) return undefined;
  if (app.operators.get(call.op) === undefined) return 'Not available here yet';
  try {
    const result = app.operators.poll(call.op, { panel: PANEL.viewport, paneId: PANE }, call.args);
    return result === true ? undefined : result.reason;
  } catch {
    return undefined;
  }
}

export function CurveHalo({
  controller,
  shown,
  focus,
  frame,
}: {
  readonly controller: HaloController;
  /** The curves the layer draws. */
  readonly shown: readonly CurveId[];
  /** The tapped curve, if any. */
  readonly focus: CurveId | null;
  /** The playhead in the animation's frames (*Insert key* lands there). */
  readonly frame: number;
}): JSX.Element | null {
  const { ctx } = controller;
  const { app, store } = ctx;
  const [menu, setMenu] = useState<string | null>(null);
  if (shown.length === 0) return null;
  const subject = focus !== null && shown.includes(focus) ? focus : null;
  const curveFor = subject ?? (shown[0] as CurveId);
  const count = (): void => store.set((s) => ({ touches: s.touches + 1 }));
  const actions = new Map<string, Action>();
  for (const petal of petalsFor('curve', 'animate')) {
    switch (petal.id) {
      case 'easeAll':
        // every key of the subject curves first, so the ease lands on all of them (Pro's own tangent call after)
        actions.set(petal.id, {
          menu: (petal.menu ?? []).map((choice) => ({
            label: choice.plain,
            calls: [
              {
                op: 'select.keys',
                args: { items: curveKeyItems(app, subject === null ? shown : [subject]), mode: 'replace' },
              },
              { op: choice.op, ...(choice.args === undefined ? {} : { args: choice.args }) },
            ],
          })),
        });
        break;
      case 'cycle':
        actions.set(petal.id, {
          menu: (petal.menu ?? []).map((choice) => ({
            label: choice.plain,
            calls: [{ op: choice.op, ...(choice.args === undefined ? {} : { args: choice.args }) }],
          })),
        });
        break;
      case 'fewerKeys':
        actions.set(petal.id, { form: { op: 'graph.curves.simplify' } });
        break;
      case 'fixFlips':
        actions.set(petal.id, { calls: [{ op: 'graph.eulerFilter' }] });
        break;
      case 'insertKey':
        actions.set(petal.id, {
          calls: [{ op: 'graph.key.insert', args: { curve: curveFor, frame: Math.round(frame) } }],
        });
        break;
      default:
        break;
    }
  }
  const pollCall = (id: string, action: Action): OpCall | undefined => {
    if ('calls' in action) return action.calls[0];
    if ('form' in action) return action.form;
    if (id === 'easeAll') return { op: 'graph.tangent.set', args: { type: 'auto' } };
    return action.menu[0]?.calls.at(-1);
  };
  const items: VerbItem[] = [...actions.entries()].map(([id, action]) => {
    const reason = pollOf(app, pollCall(id, action));
    return {
      id,
      label: LABEL[id] ?? id,
      icon: <AnimateGlyph name={ICON[id] ?? 'key'} />,
      ...('menu' in action ? { hasMenu: true } : {}),
      ...(reason === undefined ? {} : { disabledReason: reason }),
    };
  });
  const run = async (calls: readonly OpCall[]): Promise<void> => {
    for (const call of calls) {
      const result = await ctx.run(call.op, call.args);
      if (result.status !== 'finished') return;
    }
  };
  const select = (id: string): void => {
    const action = actions.get(id);
    if (action === undefined) return;
    count();
    if ('menu' in action) {
      setMenu(menu === id ? null : id);
      return;
    }
    setMenu(null);
    if ('form' in action) {
      store.set({
        form: { op: action.form.op, ...(action.form.args === undefined ? {} : { args: action.form.args }) },
      });
      return;
    }
    void run(action.calls);
  };
  const open = menu === null ? undefined : actions.get(menu);
  const name = subject === null ? w.curveTitle(shown.length) : w.curve;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5" data-testid="halo-curve-halo">
      <VerbBar
        className="min-w-0 flex-1"
        data-testid="halo-curve-verbs"
        label={name}
        verbs={items}
        onSelect={select}
        onMore={() => {
          count();
          setMenu(null);
          store.set({
            sheet: 'more',
            sheetArgs: null,
            sheetNoun: threadNoun('curve', curveFor, name, animateCharacter(app)),
            halo: null,
            focus: null,
          });
        }}
        onReason={(_id, reason) => ctx.toasts.push({ key: 'reason', text: reason })}
      />
      {open !== undefined && 'menu' in open ? (
        <div
          role="menu"
          aria-label={LABEL[menu ?? ''] ?? ''}
          className="flex flex-wrap items-center gap-1.5"
          data-testid="halo-curve-menu"
        >
          {open.menu.map((choice) => (
            <TouchButton
              key={choice.label}
              role="menuitem"
              data-testid={`halo-curve-choice-${choice.label}`}
              onClick={() => {
                count();
                setMenu(null);
                void run(choice.calls);
              }}
            >
              {choice.label}
            </TouchButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}
