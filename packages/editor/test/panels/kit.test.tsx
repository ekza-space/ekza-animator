import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { act, type JSX, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExpressionField, NumberField } from '../../src/panels/channels/kit/fields';
import {
  formatChannelValue,
  formatFixed,
  fromDisplayValue,
  parseNumericInput,
  toDisplayValue,
} from '../../src/panels/channels/kit/kernel';
import { type MenuEntry, useContextMenu } from '../../src/panels/channels/kit/menu';
import { selectModeOf } from '../../src/panels/channels/kit/run';
import { by, cleanup, input, maybe, mountPlain as render, user } from './helpers';

afterEach(cleanup);

describe('kernel adapters', () => {
  it('parses the spec examples relative to the current display value (MVP-SPEC §7 WP-7a)', () => {
    expect(parseNumericInput('45', 30)).toBe(45);
    expect(parseNumericInput('+=10', 30)).toBe(40);
    expect(parseNumericInput('-=5', 30)).toBe(25);
    expect(parseNumericInput('*2', 30)).toBe(60);
    expect(parseNumericInput('/2', 30)).toBe(15);
    expect(parseNumericInput('1.5rad', 0)).toBeCloseTo((1.5 * 180) / Math.PI, 12);
    expect(parseNumericInput('90deg', 0)).toBe(90);
    expect(parseNumericInput('abc', 0)).toBeNull();
    expect(parseNumericInput('', 0)).toBeNull();
  });

  it('the fields use the research 09 §6.4 grammar (editor-core parseNumericInput)', () => {
    const cases: readonly (readonly [string, number, number | null])[] = [
      ['=12.5', 0, 12.5],
      ['-5', 30, -5],
      ['+5', 30, 5],
      ['*=1.5', 10, 15],
      ['/=4', 10, 2.5],
      ['(1 + 2) * 3', 0, 9],
      ['2 * -3', 0, -6],
      ['1 - 2 - 3', 0, -4],
      ['8 / 2 / 2', 0, 2],
      ['.5', 0, 0.5],
      ['45°', 0, 45],
      ['+=(2+3)deg', 1, 6],
      ['1/0', 0, null],
      ['/=0', 10, null],
      ['(1 + 2', 0, null],
      ['1 +', 0, null],
      ['1 2', 0, null],
      ['45 deg deg', 0, null],
      ['++', 0, null],
      ['   ', 0, null],
    ];
    const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 1e9) / 1e9);
    expect(cases.map(([text, current]) => [text, round(parseNumericInput(text, current))])).toEqual(
      cases.map(([text, , expected]) => [text, round(expected)]),
    );
  });

  it('formats channel values in display units with three decimals and no negative zero', () => {
    expect(formatChannelValue('rz', Math.PI / 4)).toBe('45.000');
    expect(formatChannelValue('tx', 1.23456)).toBe('1.235');
    expect(formatChannelValue('rx', -1e-9)).toBe('0.000');
    expect(formatFixed(-0.0004, 3)).toBe('0.000');
    expect(formatFixed(-0.5, 1)).toBe('-0.5');
    expect(toDisplayValue('ry', Math.PI)).toBeCloseTo(180, 12);
    expect(fromDisplayValue('ry', 180)).toBeCloseTo(Math.PI, 12);
    expect(toDisplayValue('sx', 1.5)).toBe(1.5);
  });

  it('maps click modifiers to selection modes per platform (research 09 §6.1)', () => {
    const other = createFakeEditorApp({ platform: 'other' });
    const mac = createFakeEditorApp({ platform: 'mac' });
    const ev = (mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey', boolean>>) => ({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      ...mods,
    });
    expect(selectModeOf(other, ev({}))).toBe('replace');
    expect(selectModeOf(other, ev({ shiftKey: true }))).toBe('toggle');
    expect(selectModeOf(other, ev({ ctrlKey: true }))).toBe('remove');
    expect(selectModeOf(other, ev({ ctrlKey: true, shiftKey: true }))).toBe('add');
    expect(selectModeOf(other, ev({ metaKey: true }))).toBe('replace');
    expect(selectModeOf(mac, ev({ metaKey: true }))).toBe('remove');
    expect(selectModeOf(mac, ev({ metaKey: true, shiftKey: true }))).toBe('add');
    expect(selectModeOf(mac, ev({ ctrlKey: true }))).toBe('replace');
  });
});

describe('ExpressionField', () => {
  function Harness(props: {
    readonly onCommit: (draft: string) => string | null;
    readonly onTab?: (backwards: boolean) => void;
  }) {
    const [text] = useState('10.000');
    return (
      <>
        <ExpressionField text={text} ariaLabel="value" testId="field" onCommit={props.onCommit} onTab={props.onTab} />
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
      </>
    );
  }

  it('commits on Enter, keeps an invalid draft with its reason, and reverts on Escape', async () => {
    const commits: string[] = [];
    const view = await render(
      <Harness onCommit={(draft) => (draft === 'bad' ? 'not a number' : (commits.push(draft), null))} />,
    );
    const field = input('field');
    await user.fill(field, 'bad');
    await user.keyboard('{Enter}');
    expect(commits).toEqual([]);
    expect(field.dataset.invalid).toBe('true');
    expect(field.title).toBe('not a number');
    expect(document.activeElement).toBe(field);

    await user.keyboard('{Escape}');
    expect(field.value).toBe('10.000');
    expect(field.dataset.invalid).toBeUndefined();
    expect(document.activeElement).not.toBe(field);

    await user.fill(field, '+=5');
    await user.keyboard('{Enter}');
    expect(commits).toEqual(['+=5']);
    expect(document.activeElement).not.toBe(field);
    await view.unmount();
  });

  it('commits a changed draft on blur, drops an invalid one, and ignores an untouched field', async () => {
    const commits: string[] = [];
    const view = await render(<Harness onCommit={(d) => (d === 'x' ? 'bad' : (commits.push(d), null))} />);
    const field = input('field');
    await user.click(field);
    await user.click(by('elsewhere'));
    expect(commits).toEqual([]);
    await user.fill(field, '12');
    await user.click(by('elsewhere'));
    expect(commits).toEqual(['12']);
    await user.fill(field, 'x');
    await user.click(by('elsewhere'));
    expect(commits).toEqual(['12']);
    expect(field.value).toBe('10.000');
    await view.unmount();
  });

  it('hands Tab to onTab after committing', async () => {
    const onTab = vi.fn<(backwards: boolean) => void>();
    const commits: string[] = [];
    const view = await render(<Harness onCommit={(d) => (commits.push(d), null)} onTab={onTab} />);
    await user.fill(input('field'), '7');
    await user.keyboard('{Tab}');
    expect(commits).toEqual(['7']);
    expect(onTab).toHaveBeenCalledWith(false);
    await view.unmount();
  });

  it('shows the reason of a rejected draft in a message under the field, described by it', async () => {
    const view = await render(<Harness onCommit={() => "'abc' is not a number or expression"} />);
    const field = input('field');
    expect(maybe('field-message')).toBeNull();
    await user.fill(field, 'abc');
    await user.keyboard('{Enter}');
    const message = by('field-message');
    expect(message.textContent).toBe("'abc' is not a number or expression");
    expect(message.getAttribute('role')).toBe('alert');
    expect(field.getAttribute('aria-describedby')).toBe(message.id);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const below = field.getBoundingClientRect();
    const at = message.getBoundingClientRect();
    expect(message.style.visibility).toBe('visible');
    expect(at.top).toBeGreaterThanOrEqual(below.bottom);
    expect(at.top - below.bottom).toBeLessThan(8);
    // Typing again clears the reason; leaving the field drops the draft and the message.
    await user.fill(field, 'ab');
    expect(maybe('field-message')).toBeNull();
    expect(field.hasAttribute('aria-describedby')).toBe(false);
    await view.unmount();
  });

  it('drops the state colours while a draft is typed and restores them after', async () => {
    const view = await render(
      <ExpressionField
        text="1.000"
        ariaLabel="value"
        testId="field"
        style={{ background: 'rgb(200, 50, 60)' }}
        onCommit={() => null}
      />,
    );
    const field = input('field');
    expect(field.style.background).toBe('rgb(200, 50, 60)');
    await user.click(field);
    expect(field.style.background).toBe('rgb(200, 50, 60)'); // focus alone keeps the state visible
    await user.fill(field, '2');
    expect(field.dataset.drafting).toBe('true');
    expect(field.style.background).toBe('');
    await user.keyboard('{Escape}');
    expect(field.style.background).toBe('rgb(200, 50, 60)');
    await view.unmount();
  });

  it('a read-only field reports value keys and nudges once per focus, and ignores other keys', async () => {
    const rejected = vi.fn<() => void>();
    const nudges = vi.fn<(direction: 1 | -1) => void>();
    const view = await render(
      <>
        <ExpressionField
          text="5.000"
          ariaLabel="locked value"
          testId="field"
          readOnly
          onCommit={() => null}
          onNudge={nudges}
          onRejectedEdit={rejected}
        />
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
      </>,
    );
    const field = input('field');
    await user.click(field);
    await user.keyboard('a{Shift>}{/Shift}');
    expect(rejected).not.toHaveBeenCalled();
    await user.keyboard('4');
    await user.keyboard('5{ArrowUp}');
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(nudges).not.toHaveBeenCalled();
    expect(field.value).toBe('5.000');
    await user.click(by('elsewhere'));
    await user.click(field);
    await user.keyboard('{ArrowDown}');
    expect(rejected).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});

describe('NumberField', () => {
  it('parses expressions against the current value and applies `validate` and `onEmpty`', async () => {
    const values: number[] = [];
    let cleared = 0;
    const view = await render(
      <NumberField
        value={10}
        ariaLabel="size"
        testId="number"
        validate={(v) => (v > 0 ? null : 'must be positive')}
        onValue={(v) => values.push(v)}
        onEmpty={() => {
          cleared++;
          return null;
        }}
      />,
    );
    const field = input('number');
    expect(field.value).toBe('10.000');
    await user.fill(field, '*3');
    await user.keyboard('{Enter}');
    expect(values).toEqual([30]);
    await user.fill(field, '-=20');
    await user.keyboard('{Enter}');
    expect(values).toEqual([30]);
    expect(field.title).toBe('must be positive');
    await user.fill(field, '');
    await user.keyboard('{Enter}');
    expect(cleared).toBe(1);
    await view.unmount();
  });
});

describe('context menu', () => {
  function Host(props: { readonly entries: readonly MenuEntry[] }): JSX.Element {
    const menu = useContextMenu();
    return (
      <div>
        <button type="button" data-testid="host" onContextMenu={(event) => menu.open(event, 'Test', props.entries)}>
          host
        </button>
        <button type="button" data-testid="outside">
          outside
        </button>
        {menu.element}
      </div>
    );
  }

  let chosen: string[] = [];
  const entries: readonly MenuEntry[] = [
    { kind: 'item', id: 'a', label: 'Alpha', testId: 'item-a', onSelect: () => chosen.push('a') },
    { kind: 'item', id: 'b', label: 'Beta', testId: 'item-b', disabled: true, onSelect: () => chosen.push('b') },
    { kind: 'separator', id: 's' },
    { kind: 'item', id: 'c', label: 'Gamma', testId: 'item-c', checked: true, onSelect: () => chosen.push('c') },
  ];
  beforeAll(() => {
    chosen = [];
  });

  it('opens at the pointer, skips disabled items with the keyboard and closes after a choice', async () => {
    chosen = [];
    const view = await render(<Host entries={entries} />);
    await user.rightClick(by('host'));
    const menu = by('data-panel-menu');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(document.activeElement).toBe(by('item-a'));
    expect(by('item-c').getAttribute('aria-checked')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(by('item-c'));
    await user.keyboard('{Enter}');
    expect(chosen).toEqual(['c']);
    expect(maybe('data-panel-menu')).toBeNull();
    expect(document.activeElement).toBe(by('host'));

    await user.rightClick(by('host'));
    await user.click(by('item-b'), { force: true });
    expect(chosen).toEqual(['c']);
    await user.keyboard('{Escape}');
    expect(maybe('data-panel-menu')).toBeNull();

    await user.rightClick(by('host'));
    await user.click(by('outside'));
    expect(maybe('data-panel-menu')).toBeNull();
    expect(chosen).toEqual(['c']);
    await view.unmount();
  });
});
