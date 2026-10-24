import type { CharacterId, ControlId, ControlRecord } from '@ekza-studio/doc';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { OutlinerPanel, rowIndentPx } from '../../src/panels/outliner/OutlinerPanel';
import { hoveredControl } from '../../src/panels/outliner/hover';
import { buildOutlinerRows, controlHierarchy, readOutlinerDoc, revealKeys } from '../../src/panels/outliner/model';
import {
  by,
  CLIP,
  callsOf,
  cleanup,
  control,
  input,
  LOWER_ARM_L,
  loadFixtures,
  maybe,
  mount,
  newClip,
  newControl,
  ROOT,
  select,
  setSession,
  transact,
  UPPER_ARM_L,
  user,
  waveApp,
} from './helpers';

const CHARACTER = 'chr_SyntheticWave001' as CharacterId;
afterEach(cleanup);
const panel = (app: ReturnType<typeof waveApp>) => mount(app, <OutlinerPanel app={app} instanceId="outliner#1" />);
const row = (id: ControlId): HTMLElement => by(`outliner-row-${id}`);
const visibleControlRows = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="outliner-row-"]')].map((el) =>
    (el.dataset.testid ?? '').slice('outliner-row-'.length),
  );

beforeAll(async () => {
  await loadFixtures();
});

describe('Outliner tree (FR-OUT-01)', () => {
  it('shows Character → Rig (control hierarchy) / Skeleton (collapsed) / Clips with side-coloured icons', async () => {
    const app = waveApp();
    const view = await panel(app);
    expect(by(`outliner-character-${CHARACTER}`).textContent).toContain('Synthetic Humanoid');
    expect(by(`outliner-character-${CHARACTER}`).textContent).toContain('VRM 1.0');
    expect(by(`outliner-group-rig-${CHARACTER}`).textContent).toContain('(27)');
    expect(by(`outliner-group-skeleton-${CHARACTER}`).textContent).toContain('(25)');
    expect(by(`outliner-group-skeleton-${CHARACTER}`).getAttribute('aria-expanded')).toBe('false');
    expect(by(`outliner-group-clips-${CHARACTER}`).textContent).toContain('(1)');
    expect(by(`outliner-clip-${CLIP}`).textContent).toContain('wave');

    // Parents before children, nested by depth; the root control first.
    const ids = visibleControlRows();
    expect(ids[0]).toBe(ROOT);
    expect(ids).toContain(LOWER_ARM_L);
    expect(ids.indexOf(UPPER_ARM_L)).toBeLessThan(ids.indexOf(LOWER_ARM_L));
    expect(Number(row(LOWER_ARM_L).getAttribute('aria-level'))).toBe(
      Number(row(UPPER_ARM_L).getAttribute('aria-level')) + 1,
    );

    // Humanoid name as secondary text; side colours L blue, R red, C yellow.
    expect(row(LOWER_ARM_L).textContent).toContain('leftLowerArm');
    const iconColor = (id: ControlId): string => row(id).querySelectorAll('svg')[1]?.style.color ?? '';
    expect(iconColor(LOWER_ARM_L)).toContain('--rig-left');
    expect(iconColor(control('fk.lowerArm.R'))).toContain('--rig-right');
    expect(iconColor(ROOT)).toContain('--rig-center');
    await view.unmount();
  });

  it('lists read-only bones with VRM humanoid names; a bone selects the control that drives it', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(by(`outliner-group-skeleton-${CHARACTER}`));
    const bone = by(`outliner-bone-${CHARACTER}-10`);
    expect(bone.textContent).toContain('leftLowerArm');
    expect(bone.getAttribute('aria-selected')).toBeNull();
    await user.click(bone);
    expect(callsOf(app, 'select.controls')).toEqual([{ ids: [LOWER_ARM_L], mode: 'replace' }]);
    await view.unmount();
  });

  it('says when no runtime (skeleton) is loaded yet and when there is no character', async () => {
    const app = waveApp({ skeleton: false });
    const view = await panel(app);
    expect(by(`outliner-group-skeleton-${CHARACTER}`).textContent).toContain('(not loaded)');
    await view.unmount();

    const empty = waveApp({ skeleton: false });
    await transact(empty, (tx) => tx.softDelete('characters', CHARACTER));
    const emptyView = await panel(empty);
    expect(by('outliner-empty').textContent).toContain('No character');
    await emptyView.unmount();
  });

  it('hides secondary controls unless the session shows them; the toggle runs rig.toggleSecondary', async () => {
    const app = waveApp();
    const hat = newControl(app, 'sec.hat', { group: 'secondary', hiddenByDefault: true, parent: control('fk.head') });
    await transact(app, (tx) => tx.put('controls', hat));
    const view = await panel(app);
    expect(maybe(`outliner-row-${hat.id}`)).toBeNull();
    await user.click(by('outliner-toggle-secondary'));
    expect(callsOf(app, 'rig.toggleSecondary')).toHaveLength(1);
    await setSession(app, { showSecondary: true });
    expect(row(hat.id).getAttribute('aria-level')).toBe(
      String(Number(row(control('fk.head')).getAttribute('aria-level')) + 1),
    );
    expect(by('outliner-toggle-secondary').getAttribute('aria-pressed')).toBe('true');
    await view.unmount();
  });
});

describe('Outliner filter (FR-OUT-02)', () => {
  it('matches names, template keys and VRM humanoid names, keeping ancestors for context', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.fill(input('outliner-filter'), 'leftHand');
    const hand = control('fk.hand.L');
    expect(row(hand).dataset.match).toBe('true');
    expect(row(LOWER_ARM_L).dataset.match).toBeUndefined(); // ancestor shown for context
    expect(maybe(`outliner-row-${control('fk.hand.R')}`)).toBeNull();
    expect(maybe(`outliner-clip-${CLIP}`)).toBeNull();
    // The skeleton group opens to show the matching bone.
    expect(by(`outliner-bone-${CHARACTER}-11`).dataset.match).toBe('true');

    await user.fill(input('outliner-filter'), 'L LOWER');
    // Tree order: the legs hang under fk.hips, which comes before fk.spine under cog.
    expect(visibleControlRows().filter((id) => row(id as ControlId).dataset.match === 'true')).toEqual([
      control('fk.lowerLeg.L'),
      LOWER_ARM_L,
    ]);

    await user.fill(input('outliner-filter'), 'fk.toes');
    expect(visibleControlRows().filter((id) => row(id as ControlId).dataset.match === 'true')).toEqual([
      control('fk.toes.L'),
      control('fk.toes.R'),
    ]);

    await user.fill(input('outliner-filter'), 'wave');
    expect(by(`outliner-clip-${CLIP}`).dataset.match).toBe('true');
    expect(visibleControlRows()).toEqual([]);

    await user.fill(input('outliner-filter'), 'no such thing');
    expect(by('outliner-empty').textContent).toContain("Nothing matches 'no such thing'");
    await user.keyboard('{Escape}');
    expect(input('outliner-filter').value).toBe('');
    expect(visibleControlRows().length).toBe(27);
    await view.unmount();
  });

  it('the background menu expands and collapses everything', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.rightClick(by(`outliner-group-clips-${CHARACTER}`));
    await user.click(by('outliner-menu-collapse-all'));
    expect(maybe(`outliner-group-rig-${CHARACTER}`)).toBeNull();
    expect(by(`outliner-character-${CHARACTER}`).getAttribute('aria-expanded')).toBe('false');
    await user.rightClick(by(`outliner-character-${CHARACTER}`));
    await user.click(by('outliner-menu-expand-all'));
    expect(by(`outliner-group-skeleton-${CHARACTER}`).getAttribute('aria-expanded')).toBe('true');
    expect(maybe(`outliner-row-${LOWER_ARM_L}`)).not.toBeNull();
    await view.unmount();
  });

  it('a matching character name shows the whole character', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.fill(input('outliner-filter'), 'synthetic');
    expect(visibleControlRows().length).toBe(27);
    expect(by(`outliner-character-${CHARACTER}`).dataset.match).toBe('true');
    await view.unmount();
  });
});

describe('Outliner selection (FR-OUT-03)', () => {
  it('a real click replaces the selection and Shift+click toggles', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(row(LOWER_ARM_L));
    await user.click(row(UPPER_ARM_L), { modifiers: ['Shift'] });
    expect(callsOf(app, 'select.controls')).toEqual([
      { ids: [LOWER_ARM_L], mode: 'replace' },
      { ids: [UPPER_ARM_L], mode: 'toggle' },
    ]);
    await view.unmount();
  });

  // Synthetic clicks: on a macOS test host a real Ctrl+click is a context click, whatever the app's platform.
  it.each([
    ['other', {}, 'replace'],
    ['other', { shiftKey: true }, 'toggle'],
    ['other', { ctrlKey: true }, 'remove'],
    ['other', { ctrlKey: true, shiftKey: true }, 'add'],
    ['other', { metaKey: true }, 'replace'],
    ['mac', { metaKey: true }, 'remove'],
    ['mac', { metaKey: true, shiftKey: true }, 'add'],
  ] as const)('on %s, a click with %o selects in mode %s', async (platform, modifiers, mode) => {
    const app = waveApp({ platform });
    const view = await panel(app);
    await act(async () => {
      row(LOWER_ARM_L).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
    });
    expect(callsOf(app, 'select.controls')).toEqual([{ ids: [LOWER_ARM_L], mode }]);
    await view.unmount();
  });

  it('follows the session: selected rows and the lead are marked, and a hidden lead is revealed', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [UPPER_ARM_L, LOWER_ARM_L]);
    expect(row(UPPER_ARM_L).getAttribute('aria-selected')).toBe('true');
    expect(row(LOWER_ARM_L).getAttribute('aria-selected')).toBe('true');
    expect(row(LOWER_ARM_L).dataset.lead).toBe('true');
    expect(row(UPPER_ARM_L).dataset.lead).toBeUndefined();
    expect(row(ROOT).getAttribute('aria-selected')).toBe('false');

    // Collapse the rig group; selecting from elsewhere (viewport) re-expands the path to the new lead.
    await user.click(by(`outliner-group-rig-${CHARACTER}`));
    expect(maybe(`outliner-row-${LOWER_ARM_L}`)).toBeNull();
    const finger = control('fk.indexProximal.L');
    await select(app, [finger]);
    expect(row(finger).dataset.lead).toBe('true');
    expect(by(`outliner-group-rig-${CHARACTER}`).getAttribute('aria-expanded')).toBe('true');
    await view.unmount();
  });

  it('hovering a control row asks the viewport to pre-highlight it (session hoverControl, wp-notes R-2)', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.hover(row(LOWER_ARM_L));
    expect(hoveredControl(app)).toBe(LOWER_ARM_L);
    await user.hover(row(ROOT));
    expect(hoveredControl(app)).toBe(ROOT);
    await user.hover(by('outliner-filter'));
    expect(hoveredControl(app)).toBeNull();
    await view.unmount();
  });

  it('context menu: selects the row first, then Select Hierarchy, Frame Selection and Reset Pose', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.rightClick(row(UPPER_ARM_L));
    expect(callsOf(app, 'select.controls')).toEqual([{ ids: [UPPER_ARM_L], mode: 'replace' }]);
    await user.click(by('outliner-menu-select-hierarchy'));
    expect(callsOf(app, 'select.controls')[1]).toEqual({
      ids: [LOWER_ARM_L, control('fk.hand.L'), control('fk.indexProximal.L'), UPPER_ARM_L],
      mode: 'replace',
    });

    // With the row part of the selection, actions apply to the whole selection.
    await select(app, [UPPER_ARM_L, LOWER_ARM_L]);
    await user.rightClick(row(LOWER_ARM_L));
    await user.click(by('outliner-menu-reset'));
    expect(callsOf(app, 'pose.resetToRest')).toEqual([{ controls: [UPPER_ARM_L, LOWER_ARM_L] }]);
    await user.rightClick(row(LOWER_ARM_L));
    await user.click(by('outliner-menu-frame'));
    expect(callsOf(app, 'view.frame')).toEqual([{ what: 'selection' }]);
    expect(callsOf(app, 'select.controls')).toHaveLength(2);
    await view.unmount();
  });
});

describe('Outliner clips and keyboard', () => {
  it('activates a clip on click and renames it inline (FR-OUT-04)', async () => {
    const app = waveApp();
    const idle = newClip(app, 'clp_SyntheticIdle0001', { name: 'idle' });
    await transact(app, (tx) => tx.put('clips', idle));
    const view = await panel(app);
    expect(by(`outliner-clip-${CLIP}`).textContent).toContain('●');
    await user.click(by(`outliner-clip-${idle.id}`));
    expect(callsOf(app, 'clip.setActive')).toEqual([{ clip: idle.id }]);
    await user.click(by(`outliner-clip-${CLIP}`)); // already active: nothing to do
    expect(callsOf(app, 'clip.setActive')).toHaveLength(1);

    await user.dblClick(by(`outliner-clip-${idle.id}`));
    await user.fill(input('clips-rename-input'), 'idle_breath');
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'clip.rename')).toEqual([{ clip: idle.id, name: 'idle_breath' }]);
    expect(maybe('clips-rename-input')).toBeNull();
    await view.unmount();
  });

  it('navigates as an ARIA tree: arrows move, ← collapses / goes to the parent, Enter selects', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(row(ROOT));
    const tree = by('outliner-tree');
    const active = (): string | null => {
      const id = tree.getAttribute('aria-activedescendant');
      return id === null ? null : (document.getElementById(id)?.dataset.testid ?? null);
    };
    expect(document.activeElement).toBe(tree);
    expect(active()).toBe(`outliner-row-${ROOT}`);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(`outliner-row-${control('cog')}`);
    await user.keyboard('{ArrowLeft}'); // cog is expanded: collapse it
    expect(row(control('cog')).getAttribute('aria-expanded')).toBe('false');
    expect(maybe(`outliner-row-${control('fk.hips')}`)).toBeNull();
    await user.keyboard('{ArrowLeft}'); // collapsed: go to the parent
    expect(active()).toBe(`outliner-row-${ROOT}`);
    await user.keyboard('{ArrowDown}{ArrowRight}'); // expand cog again
    expect(row(control('cog')).getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowRight}'); // to its first child
    expect(active()).toBe(`outliner-row-${control('fk.hips')}`);
    await user.keyboard('{Enter}');
    expect(callsOf(app, 'select.controls').at(-1)).toEqual({ ids: [control('fk.hips')], mode: 'replace' });
    // Space is left to the global keymap (maximize the hovered panel): the tree neither selects nor consumes it.
    const selections = callsOf(app, 'select.controls').length;
    let spaceReachedWindow = false;
    const onSpace = (event: KeyboardEvent): void => {
      if (event.key === ' ' && !event.defaultPrevented) spaceReachedWindow = true;
    };
    window.addEventListener('keydown', onSpace);
    await user.keyboard(' ');
    window.removeEventListener('keydown', onSpace);
    expect(spaceReachedWindow).toBe(true);
    expect(callsOf(app, 'select.controls')).toHaveLength(selections);
    await user.keyboard('/');
    expect(document.activeElement).toBe(input('outliner-filter'));
    await view.unmount();
  });

  it('leaves its keys to the hovered panel: F, Home and End over the viewport are not tree keys (acceptance round 2)', async () => {
    const app = waveApp();
    const view = await panel(app);
    await user.click(row(ROOT));
    const tree = by('outliner-tree');
    expect(document.activeElement).toBe(tree);
    const reached: string[] = [];
    const onKey = (event: KeyboardEvent): void => {
      if (!event.defaultPrevented) reached.push(event.key);
    };
    window.addEventListener('keydown', onKey);
    try {
      await setSession(app, { hoveredPanel: { kind: 'viewport', paneId: 'pane-right' } });
      const before = tree.getAttribute('aria-activedescendant');
      await user.keyboard('{End}f{Home}');
      expect(reached).toEqual(['End', 'f', 'Home']);
      expect(tree.getAttribute('aria-activedescendant')).toBe(before);
      // Over the Outliner itself they are tree keys again.
      await setSession(app, { hoveredPanel: { kind: 'outliner', paneId: null } });
      await user.keyboard('{End}');
      expect(reached).toEqual(['End', 'f', 'Home']);
      expect(tree.getAttribute('aria-activedescendant')).not.toBe(before);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
    await view.unmount();
  });

  it('indents deep rows less, so a finger chain at depth 10 keeps its chevron near the left (acceptance round 2)', () => {
    const steps = Array.from({ length: 12 }, (_, depth) => rowIndentPx(depth));
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1] as number);
    expect(rowIndentPx(2)).toBe(4 + 2 * 12);
    expect(rowIndentPx(10)).toBeLessThanOrEqual(84);
  });

  it('virtualizes long rigs: only the rows in view are in the DOM', async () => {
    const app = waveApp();
    const extra: ControlRecord[] = Array.from({ length: 2000 }, (_, i) =>
      newControl(app, `sec.chain${String(i).padStart(4, '0')}`, {
        parent: ROOT,
        order: `z${String(i).padStart(4, '0')}`,
      }),
    );
    await transact(app, (tx) => {
      for (const record of extra) tx.put('controls', record);
    });
    const view = await panel(app);
    const rendered = document.querySelectorAll('[role="treeitem"]').length;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(120);
    const last = extra[1999]?.id ?? ROOT;
    expect(maybe(`outliner-row-${last}`)).toBeNull();
    const tree = by('outliner-tree');
    await act(async () => {
      tree.scrollTop = tree.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 250)); // past the virtualizer's is-scrolling reset
    });
    expect(maybe(`outliner-row-${last}`)).not.toBeNull();
    expect(maybe(`outliner-row-${ROOT}`)).toBeNull();
    // Selecting from elsewhere scrolls the lead back into view.
    await select(app, [ROOT]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250)); // the virtualizer scrolls on the next frames
    });
    expect(maybe(`outliner-row-${ROOT}`)).not.toBeNull();
    await view.unmount();
  });
});

describe('Outliner model', () => {
  let doc: ReturnType<typeof readOutlinerDoc>;
  beforeAll(() => {
    doc = readOutlinerDoc(waveApp().store);
  });

  it('builds the hierarchy below the hidden-secondary parents and computes hierarchies and reveal paths', () => {
    const controls = doc.characters[0]?.controls ?? [];
    expect(controlHierarchy(controls, [UPPER_ARM_L], false)).toEqual([
      UPPER_ARM_L,
      LOWER_ARM_L,
      control('fk.hand.L'),
      control('fk.indexProximal.L'),
    ]);
    // A hidden secondary control is skipped but walked through: its shown children still belong to the hierarchy.
    const head = controls.find((c) => c.key === 'fk.head');
    if (head === undefined) throw new Error('no fk.head');
    const hat = { ...head, id: control('sec.hat'), key: 'sec.hat', group: 'secondary' as const, parent: head.id };
    const feather = { ...head, id: control('acc.feather'), key: 'acc.feather', parent: hat.id };
    const withHat = [...controls, hat, feather];
    expect(controlHierarchy(withHat, [head.id], false)).toEqual([head.id, control('fk.jaw'), feather.id]);
    expect(controlHierarchy(withHat, [head.id], true)).toEqual([head.id, control('fk.jaw'), hat.id, feather.id]);
    expect(revealKeys(doc, control('fk.hand.L'))).toEqual([
      `chr:${CHARACTER}`,
      `grp:${CHARACTER}:rig`,
      `ctl:${ROOT}`,
      `ctl:${control('cog')}`,
      `ctl:${control('fk.spine')}`,
      `ctl:${control('fk.chest')}`,
      `ctl:${control('fk.upperChest')}`,
      `ctl:${control('fk.shoulder.L')}`,
      `ctl:${UPPER_ARM_L}`,
      `ctl:${LOWER_ARM_L}`,
    ]);
    expect(revealKeys(doc, 'rig_X:nothing' as ControlId)).toEqual([]);
  });

  it('keeps its invariants under random filters, expansion states and secondary visibility (seeded)', async () => {
    const { skeleton } = await loadFixtures();
    const app = waveApp();
    // A secondary chain under the head (hidden by default) and a second clip make the trees less regular.
    const hat = newControl(app, 'sec.hat', { group: 'secondary', hiddenByDefault: true, parent: control('fk.head') });
    const feather = newControl(app, 'acc.feather', { parent: hat.id, side: 'L' });
    await transact(app, (tx) => {
      tx.put('controls', hat);
      tx.put('controls', feather);
      tx.put('clips', newClip(app, 'clp_SyntheticIdle0001', { name: 'Idle Loop' }));
    });
    const doc = readOutlinerDoc(app.store);
    const controls = doc.characters[0]?.controls ?? [];
    const names = [
      ...controls.flatMap((c) => [
        c.name,
        c.key,
        c.drives !== null && 'humanoid' in c.drives.bone ? c.drives.bone.humanoid : '',
      ]),
      ...skeleton.nodes.map((n) => n.name),
      'wave',
      'Idle',
      'Synthetic',
    ].filter((text) => text !== '');
    const random = mulberry32(0x5eed);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;

    // Violations are collected and asserted once, so a failure lists every broken run.
    const problems: string[] = [];
    const check = (ok: boolean, what: string): void => {
      if (!ok) problems.push(what);
    };
    let filteredRuns = 0;
    for (let run = 0; run < 300; run++) {
      const source = pick(names);
      const from = Math.floor(random() * source.length);
      const query =
        random() < 0.15 ? '' : random() < 0.1 ? 'zzz-none' : source.slice(from, from + 1 + Math.floor(random() * 6));
      const filter = random() < 0.5 ? query.toUpperCase() : `  ${query} `;
      const expanded = new Map<string, boolean>();
      for (const c of controls) if (random() < 0.2) expanded.set(`ctl:${c.id}`, random() < 0.5);
      if (random() < 0.5) expanded.set(`grp:${CHARACTER}:skeleton`, true);
      if (random() < 0.1) expanded.set(`chr:${CHARACTER}`, false);
      const showSecondary = random() < 0.5;
      const rows = buildOutlinerRows(doc, {
        filter,
        showSecondary,
        hiddenControls: new Set(),
        expanded,
        skeletons: new Map([[CHARACTER, skeleton]]),
        activeCharacter: CHARACTER,
        activeClip: { [CHARACTER]: CLIP },
      });
      const context = `run ${run} (filter '${filter}', secondary ${showSecondary})`;
      const at = new Map(rows.map((r, i) => [r.key, i]));
      check(at.size === rows.length, `${context}: duplicate row keys`);
      rows.forEach((r, i) => {
        if (r.parent === null) {
          check(r.depth === 0, `${context}: root ${r.key} at depth ${r.depth}`);
          return;
        }
        const parent = at.get(r.parent);
        const parentRow = parent === undefined ? undefined : rows[parent];
        check(parent !== undefined && parent < i, `${context}: ${r.key} before or without its parent`);
        check(parentRow?.expanded === true, `${context}: ${r.key} under a collapsed parent`);
        check(r.depth > (parentRow?.depth ?? Infinity), `${context}: ${r.key} not deeper than its parent`);
      });
      const shownControls = new Set(rows.flatMap((r) => (r.kind === 'control' ? [r.control.id] : [])));
      const q = filter.trim().toLowerCase();
      check(showSecondary || !shownControls.has(hat.id), `${context}: hidden secondary control shown`);
      if (q === '' && ![...expanded.values()].includes(false)) {
        // Unfiltered and fully expanded: every shown control is listed once (none lost by re-parenting).
        check(
          shownControls.size === controls.length - (showSecondary ? 0 : 1),
          `${context}: ${shownControls.size} control rows`,
        );
      }
      if (q === '' || 'synthetic humanoid'.includes(q)) continue; // a matching character shows everything
      filteredRuns++;
      // Filtered: every control whose name, key or humanoid name contains the query is shown and marked …
      for (const c of controls) {
        if (!showSecondary && c.id === hat.id) continue;
        const humanoid = c.drives !== null && 'humanoid' in c.drives.bone ? c.drives.bone.humanoid : '';
        const hit = [c.name, c.key, humanoid].some((t) => t.toLowerCase().includes(q));
        const shown = rows.find((r) => r.kind === 'control' && r.control.id === c.id);
        check((shown?.match ?? false) === hit, `${context}: ${c.key} match ${shown?.match ?? false}, expected ${hit}`);
      }
      // … and a control row that does not match is shown only as the ancestor of a match.
      rows.forEach((r, i) => {
        if (r.kind !== 'control' || r.match) return;
        const next = rows.slice(i + 1).findIndex((x) => x.depth <= r.depth);
        const subtree = rows.slice(i + 1, next === -1 ? undefined : i + 1 + next);
        check(
          subtree.some((x) => x.match),
          `${context}: ${r.key} shown without a match below`,
        );
      });
    }
    expect(problems).toEqual([]);
    expect(filteredRuns).toBeGreaterThan(150);
  });

  it('honours explicit collapse state and the default (skeleton collapsed)', () => {
    const view = {
      filter: '',
      showSecondary: false,
      hiddenControls: new Set<ControlId>(),
      expanded: new Map([[`ctl:${control('cog')}`, false]]),
      skeletons: new Map(),
      activeCharacter: CHARACTER,
      activeClip: { [CHARACTER]: CLIP },
    };
    const rows = buildOutlinerRows(doc, view);
    const keys = rows.map((r) => r.key);
    expect(keys).toContain(`ctl:${control('cog')}`);
    expect(keys).not.toContain(`ctl:${control('fk.hips')}`);
    expect(rows.find((r) => r.kind === 'group' && r.group === 'skeleton')).toMatchObject({
      count: null,
      expandable: false,
    });
    expect(rows.find((r) => r.kind === 'clip')).toMatchObject({ active: true });
  });
});

/** A small deterministic PRNG (mulberry32) for the seeded model test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
