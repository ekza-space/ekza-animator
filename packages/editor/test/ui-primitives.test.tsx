// @ekza-animator/ui primitives the shell does not mount itself (ContextMenu, DropdownMenu, Popover, Tabs, Select,
// IconButton, the icon set): they open, select and close in a real browser with Radix props. The ui package's own
// Vitest runs in Node, so the browser checks live here.
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DISPLAY_ICONS,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  INFINITY_ICONS,
  LAYOUT_ICONS,
  LOOP_ICONS,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SimpleSelect,
  TANGENT_ICONS,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@ekza-animator/ui';
import { type JSX, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { byTestId, render, update } from './render';
import { waitFor } from './shell-helpers';

const body = (id: string): HTMLElement => byTestId(document.body, id);
const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null;
const pointer = (type: string): PointerEvent =>
  new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' });

describe('ui primitives', () => {
  it('ContextMenu opens on a context click and runs the chosen item', async () => {
    const chosen: string[] = [];
    const view = await render(
      <ContextMenu>
        <ContextMenuTrigger data-testid="cm-trigger">target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem data-testid="cm-copy" onSelect={() => chosen.push('copy')}>
            Copy
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    await update(() =>
      body('cm-trigger').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      ),
    );
    await waitFor(() => present('cm-copy'));
    await update(() => body('cm-copy').click());
    expect(chosen).toEqual(['copy']);
    await waitFor(() => !present('cm-copy'));
    await view.unmount();
  });

  it('DropdownMenu opens on press; checkbox items report their state', async () => {
    function Menu(): JSX.Element {
      const [on, setOn] = useState(false);
      return (
        <DropdownMenu>
          <DropdownMenuTrigger data-testid="dd-trigger">Display</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem checked={on} onCheckedChange={setOn} data-testid="dd-xray">
              X-ray
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem disabled data-testid="dd-disabled">
              Not now
            </DropdownMenuItem>
          </DropdownMenuContent>
          <output data-testid="dd-state">{on ? 'on' : 'off'}</output>
        </DropdownMenu>
      );
    }
    const view = await render(<Menu />);
    await update(() => body('dd-trigger').dispatchEvent(pointer('pointerdown')));
    await waitFor(() => present('dd-xray'));
    expect(body('dd-disabled').getAttribute('data-disabled')).toBe('');
    await update(() => body('dd-xray').click());
    expect(body('dd-state').textContent).toBe('on');
    await view.unmount();
  });

  it('Popover opens from its trigger and closes on Escape', async () => {
    const view = await render(
      <Popover>
        <PopoverTrigger data-testid="pop-trigger">Settings</PopoverTrigger>
        <PopoverContent data-testid="pop-content">
          <p>fps</p>
        </PopoverContent>
      </Popover>,
    );
    await update(() => body('pop-trigger').click());
    await waitFor(() => present('pop-content'));
    await update(() =>
      body('pop-content').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    await waitFor(() => !present('pop-content'));
    await view.unmount();
  });

  it('Tabs switch content; Select picks an option', async () => {
    function Panel(): JSX.Element {
      const [fps, setFps] = useState('30');
      return (
        <>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a" data-testid="tab-a">
                A
              </TabsTrigger>
              <TabsTrigger value="b" data-testid="tab-b">
                B
              </TabsTrigger>
            </TabsList>
            <TabsContent value="a" data-testid="content-a">
              first
            </TabsContent>
            <TabsContent value="b" data-testid="content-b">
              second
            </TabsContent>
          </Tabs>
          <SimpleSelect
            value={fps}
            onValueChange={setFps}
            aria-label="Frame rate"
            data-testid="fps"
            options={[
              { value: '24', label: '24 fps' },
              { value: '30', label: '30 fps' },
            ]}
          />
          <output data-testid="fps-value">{fps}</output>
        </>
      );
    }
    const view = await render(<Panel />);
    const state = (id: string) => body(id).getAttribute('data-state');
    expect([state('content-a'), state('content-b')]).toEqual(['active', 'inactive']);
    await update(() => body('tab-b').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
    await waitFor(() => state('content-b') === 'active');
    expect(state('content-a')).toBe('inactive');
    expect(body('content-b').textContent).toBe('second');

    expect(body('fps').textContent).toContain('30 fps');
    await userEvent.click(body('fps'));
    await waitFor(() => present('fps-24'));
    await userEvent.click(body('fps-24'));
    await waitFor(() => body('fps-value').textContent === '24');
    expect(body('fps').textContent).toContain('24 fps');
    await view.unmount();
  });

  it('IconButton names itself; every icon of the set renders an SVG', async () => {
    const icons = { ...TANGENT_ICONS, ...INFINITY_ICONS, ...DISPLAY_ICONS, ...LAYOUT_ICONS, ...LOOP_ICONS };
    const view = await render(
      <div>
        <IconButton label="Frame all" icon={null} pressed data-testid="icon-button" />
        {Object.entries(icons).map(([name, Icon]) => (
          <span key={name} data-testid={`icon-${name}`}>
            <Icon size={14} />
          </span>
        ))}
      </div>,
    );
    expect(body('icon-button').getAttribute('aria-label')).toBe('Frame all');
    expect(body('icon-button').getAttribute('aria-pressed')).toBe('true');
    expect(Object.keys(icons).length).toBeGreaterThan(20);
    for (const name of Object.keys(icons)) {
      const svg = body(`icon-${name}`).querySelector('svg');
      expect(svg, name).not.toBeNull();
      expect(svg?.getAttribute('width')).toBe('14');
    }
    await view.unmount();
  });
});
