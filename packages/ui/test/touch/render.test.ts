// The touch kit's markup (STUDIO-TOUCH-SPEC §18, T4): every primitive exposes the role, name and state a screen
// reader needs, and draws its targets at the touch size. Rendered to static HTML in Node; the gallery's e2e spec
// (apps/web/e2e/dev-touch.spec.ts) checks the same in a browser, with sizes and interaction.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ActionChip,
  createToastStore,
  LoupeChips,
  Numpad,
  Petal,
  Segmented,
  Sheet,
  Stepper,
  THUMB_INITIAL,
  ThumbKey,
  thumbKeyName,
  ToastRegion,
  ToggleChip,
  TouchButton,
  TouchIconButton,
  TouchRoot,
  ValueChip,
  VerbBar,
  VerbRing,
} from '../../src/touch';

const html = (el: ReactElement): string => renderToStaticMarkup(el);
const noop = (): void => undefined;

describe('touch kit markup', () => {
  it('TouchRoot is a touch scope with its clamped scale', () => {
    const out = html(h(TouchRoot, { uiScale: 1.25 }, 'x'));
    expect(out).toContain('data-density="touch"');
    expect(out).toContain('--ui-scale:1.25');
  });

  it('buttons: 44 px targets, an accessible name on icon-only ones, type="button"', () => {
    expect(html(h(TouchButton, null, 'Rig it'))).toMatch(/type="button"[^>]*min-h-\(--touch-hit\)/);
    const icon = html(h(TouchIconButton, { label: 'Undo', icon: '↶', pressed: false }));
    expect(icon).toContain('aria-label="Undo"');
    expect(icon).toContain('aria-pressed="false"');
    expect(icon).toContain('size-(--touch-hit)');
  });

  it('ValueChip is a slider with its value and unit as text, and the Pro name after it', () => {
    const out = html(
      h(ValueChip, {
        label: 'Side',
        value: -5,
        step: 1,
        unit: '°',
        min: -180,
        max: 180,
        proName: 'Rotate Z',
        state: 'keyed',
      }),
    );
    expect(out).toContain('role="slider"');
    expect(out).toContain('aria-label="Side"');
    expect(out).toContain('aria-valuenow="-5"');
    expect(out).toContain('aria-valuemin="-180"');
    expect(out).toContain('aria-valuetext="−5°, Rotate Z"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('data-state="keyed"');
    expect(out).toContain('touch-none');
  });

  it('ToggleChip and ActionChip are buttons; the toggle reports aria-pressed', () => {
    expect(html(h(ToggleChip, { label: 'Mirror edits', pressed: true }))).toMatch(
      /<button type="button" aria-pressed="true"/,
    );
    expect(html(h(ActionChip, null, 'Options'))).toContain('<button type="button"');
  });

  it('Segmented is a radio group (or a tab list) with roving tabindex', () => {
    const items = [
      { value: 'whole', label: 'Whole' },
      { value: 'faces', label: 'Faces' },
    ] as const;
    const radios = html(h(Segmented<'whole' | 'faces'>, { items, value: 'faces', onValueChange: noop, label: 'Pick' }));
    expect(radios).toContain('role="radiogroup" aria-label="Pick"');
    expect(radios.match(/role="radio"/g)).toHaveLength(2);
    expect(radios).toMatch(/aria-checked="true" tabindex="0"[^>]*>Faces/);
    expect(radios).toMatch(/aria-checked="false" tabindex="-1"[^>]*>Whole/);
    const tabs = html(
      h(Segmented<'whole' | 'faces'>, { items, value: 'whole', onValueChange: noop, label: 'Stage', kind: 'tablist' }),
    );
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toMatch(/role="tab" aria-selected="true"/);
    // per-segment test ids: derived from the group's, or the item's own
    const ids = html(
      h(Segmented<'whole' | 'faces'>, {
        items: [items[0], { ...items[1], testId: 'own-faces' }],
        value: 'whole',
        onValueChange: noop,
        label: 'Pick',
        'data-testid': 'pick',
      }),
    );
    expect(ids).toContain('data-testid="pick-whole"');
    expect(ids).toContain('data-testid="own-faces"');
    expect(radios).not.toContain('data-testid');
  });

  it('Stepper is a named group with a spinbutton and − / + that stop at the range', () => {
    const out = html(h(Stepper, { label: 'Segments', value: 1, min: 1, max: 8, onChange: noop }));
    expect(out).toContain('role="group" aria-label="Segments"');
    expect(out).toContain('role="spinbutton"');
    expect(out).toContain('aria-valuenow="1"');
    expect(out).toMatch(/aria-label="Less segments" disabled=""/);
    expect(out).toMatch(/aria-label="More segments"(?! disabled)/);
  });

  it('Numpad: a labelled panel, a 16 px+ field without the on-screen keyboard, spoken key names, Done', () => {
    const out = html(
      h(Numpad, { label: 'Distance', proName: 'Extrude Offset', value: 0.49, unit: 'm', onDone: noop, onCancel: noop }),
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('inputMode="none"');
    expect(out).toContain('aria-label="Distance value"');
    expect(out).toContain('value="0.49"');
    expect(out).toContain('text-[max(28px,var(--touch-input-text))]');
    for (const name of [
      'minus',
      'times',
      'divided by',
      'change sign',
      'delete',
      'plus 10',
      'minus 1',
      'open bracket',
    ]) {
      expect(out).toContain(`aria-label="${name}"`);
    }
    expect(out).toContain('Done');
    expect(out).not.toContain('Next');
  });

  it('Sheet is a dialog with its title as the name, a close button and a pan-y scrolling body', () => {
    const out = html(
      h(
        Sheet,
        {
          open: true,
          onOpenChange: noop,
          title: 'Everything for 1 face',
          description: 'Plain name · Pro name',
          modal: false,
        },
        'rows',
      ),
    );
    expect(out).toContain('role="dialog"');
    // the title names the dialog (Radix links `aria-labelledby` once the title has mounted; the e2e spec checks it)
    expect(out).toMatch(/<h2 id="[^"]+"[^>]*>Everything for 1 face<\/h2>/);
    expect(out).toContain('aria-label="Close"');
    expect(out).toMatch(/data-touch-scroll="" tabindex="0"/);
    expect(out).toContain('data-density="touch"');
    const bottom = html(
      h(Sheet, { open: true, onOpenChange: noop, title: 'Numbers', side: 'bottom', detent: 'peek' }, 'x'),
    );
    expect(bottom).toContain('aria-label="Sheet size: peek. Tap to change"');
    expect(bottom).toContain('data-detent="peek"');
  });

  it('ThumbKey is a toggle button named by its meaning', () => {
    const tap = { glyph: '⊕', label: 'select more' };
    const drag = { glyph: '≈', label: 'fine' };
    const out = html(h(ThumbKey, { state: THUMB_INITIAL, dispatch: noop, tap, drag }));
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-label="Select more and fine"');
    expect(out).toContain('min-h-(--touch-key)');
    expect(thumbKeyName({ ...THUMB_INITIAL, latch: 'once' }, tap)).toBe('Select more, for the next tap');
    expect(thumbKeyName({ ...THUMB_INITIAL, latch: 'locked' }, tap, drag)).toBe('Select more and fine, locked on');
    expect(thumbKeyName({ ...THUMB_INITIAL, latch: 'held' }, undefined, drag)).toBe('Fine, while held');
  });

  it('Petals are menu items with the Pro name after the label; disabled ones stay visible', () => {
    const out = html(
      h(Petal, { verb: { id: 'pull', label: 'Pull', proName: 'Extrude', hasMenu: true }, onSelect: noop }),
    );
    expect(out).toContain('role="menuitem"');
    expect(out).toContain('aria-label="Pull, Extrude"');
    expect(out).toContain('aria-haspopup="menu"');
    const off = html(
      h(Petal, { verb: { id: 'bridge', label: 'Bridge', disabledReason: 'Needs two open borders' }, onSelect: noop }),
    );
    expect(off).toContain('aria-disabled="true"');
    expect(off).not.toContain(' disabled=""');
  });

  it('VerbRing and VerbBar are named menus ending in ⋯ More', () => {
    const verbs = [
      { id: 'pull', label: 'Pull' },
      { id: 'inset', label: 'Inset' },
    ];
    const ring = html(
      h(VerbRing, {
        verbs,
        label: '1 face',
        onSelect: noop,
        onMore: noop,
        target: { left: 500, top: 300, right: 600, bottom: 400 },
        width: 1194,
        height: 834,
      }),
    );
    expect(ring).toContain('role="menu" aria-label="1 face"');
    expect(ring.match(/role="menuitem"/g)).toHaveLength(3);
    expect(ring).toMatch(/data-verb="more"[^>]*>.*More/);
    const bar = html(h(VerbBar, { verbs, label: 'Key', onSelect: noop, onMore: noop }));
    expect(bar).toContain('aria-orientation="horizontal"');
    expect(bar).toContain('inert=""');
  });

  it('caps the Halo at six petals plus More', () => {
    const verbs = Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, label: `Verb ${i}` }));
    const ring = html(
      h(VerbRing, {
        verbs,
        label: 'x',
        onSelect: noop,
        onMore: noop,
        target: { left: 500, top: 300, right: 600, bottom: 400 },
        width: 1194,
        height: 834,
      }),
    );
    expect(ring.match(/role="menuitem"/g)).toHaveLength(7);
  });

  it('LoupeChips is a named group of candidate buttons', () => {
    const out = html(
      h(LoupeChips, {
        candidates: [
          { id: 'i1', label: 'Index 1' },
          { id: 'hand', label: 'Hand control' },
        ],
        anchor: { x: 300, y: 300 },
        onPick: noop,
      }),
    );
    expect(out).toContain('role="group" aria-label="Which one?"');
    expect(out.match(/data-candidate=/g)).toHaveLength(2);
  });

  it('ToastRegion is a named, polite live list; an action is a 44 px button', () => {
    const store = createToastStore({ timers: { set: () => 0, clear: noop } });
    store.push({ text: 'Undid: select 2 faces', action: { label: 'Redo', run: noop } });
    const out = html(h(ToastRegion, { store }));
    expect(out).toContain('aria-label="Notifications"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('Undid: select 2 faces');
    expect(out).toMatch(/<button type="button" class="min-h-\(--touch-hit\)[^"]*">Redo<\/button>/);
  });
});
