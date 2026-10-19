// Status line / tool strip (research 09 §4.2, M2A-SPEC §7): viewport tools, move and rotate manipulator spaces
// (incl. gimbal), selection mask, key target (M2a), the Tween bar slot (M2a, A4 mounts the bar), auto-key and the
// viewport layout preset. Every control runs an operator.
import { type KeyTarget, PANEL, VIEWPORT_TOOL, type ManipSpace, type ViewportLayout } from '@ekza-animator/editor-core';
import {
  AutoKeyIcon,
  Bone,
  Box,
  DisplayControlsIcon,
  type IconComponent,
  LAYOUT_ICONS,
  MoveToolIcon,
  RotateToolIcon,
  SelectToolIcon,
  SpaceGimbalIcon,
  SpaceObjectIcon,
  SpaceWorldIcon,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@ekza-animator/ui';
import type { JSX, ReactNode } from 'react';
import { usePrefs, useSession } from '../hooks';
import { TweenBar } from '../panels/shared/TweenBar';
import { useShell, useShellUi } from './context';
import { shortcutFor } from './menus';

const TOOL_ICONS: Readonly<Record<string, IconComponent>> = {
  [VIEWPORT_TOOL.select]: SelectToolIcon,
  [VIEWPORT_TOOL.move]: MoveToolIcon,
  [VIEWPORT_TOOL.rotate]: RotateToolIcon,
};
const DEFAULT_TOOLS = [
  { id: VIEWPORT_TOOL.select, label: 'Select' },
  { id: VIEWPORT_TOOL.move, label: 'Move' },
  { id: VIEWPORT_TOOL.rotate, label: 'Rotate' },
] as const;

const SPACE_ICONS: Readonly<Record<ManipSpace, IconComponent>> = {
  object: SpaceObjectIcon,
  world: SpaceWorldIcon,
  gimbal: SpaceGimbalIcon,
};
const SPACE_LABELS: Readonly<Record<ManipSpace, string>> = { object: 'Object', world: 'World', gimbal: 'Gimbal' };
/** M2A-SPEC §5.19 key targets: `S` keys the selected controls, their body parts or the whole character. */
const KEY_TARGETS: readonly { readonly target: KeyTarget; readonly short: string; readonly label: string }[] = [
  { target: 'selected', short: 'Sel', label: 'Key the selected controls' },
  { target: 'bodyPart', short: 'Part', label: 'Key the body parts of the selected controls' },
  { target: 'character', short: 'Char', label: 'Key the whole character' },
];

const LAYOUTS: readonly { readonly layout: ViewportLayout; readonly label: string }[] = [
  { layout: 'single', label: 'Single view' },
  { layout: 'split', label: 'Shot camera | free camera' },
  { layout: 'quad', label: 'Four views' },
];

function Group(props: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <fieldset
      className="m-0 flex min-w-0 items-center gap-1 border-0 border-r border-line p-0 pr-2 last:border-r-0"
      aria-label={props.label}
    >
      {props.children}
    </fieldset>
  );
}

function Tip(props: {
  readonly text: string;
  readonly shortcut?: string | null;
  readonly children: ReactNode;
}): JSX.Element {
  const text =
    props.shortcut === null || props.shortcut === undefined ? props.text : `${props.text}  ${props.shortcut}`;
  return <Tooltip content={text}>{props.children}</Tooltip>;
}

export function StatusLine(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  // Viewport tools register when the GL host has created the viewport (re-read the registry then).
  useShellUi((s) => s.gl.status);
  const tool = useSession((s) => s.tools.viewport);
  const mask = useSession((s) => s.tools.selectionMask);
  const layout = useSession((s) => s.viewportLayout);
  const moveSpace = usePrefs((p) => p.moveSpace);
  const rotateSpace = usePrefs((p) => p.rotateSpace);
  const autoKey = usePrefs((p) => p.autoKey);
  const keyTarget = useSession((s) => s.tools.keyTarget);

  const registered = app.tools.list(PANEL.viewport).map((def) => ({ id: def.id, label: def.label }));
  const tools = registered.length > 0 ? registered : DEFAULT_TOOLS;
  const run = (op: string, args?: unknown): void => {
    void shell.runFromUi(op, args, { panel: PANEL.viewport });
  };
  const setSpace = (manip: 'move' | 'rotate', space: string): void => {
    if (space === '') return;
    void (async () => {
      const result = await shell.runFromUi('view.setManipSpace', { tool: manip, space }, { panel: PANEL.viewport });
      if (result.status === 'finished' && app.session.getState().tools.viewport !== manip) {
        await shell.runFromUi('view.tool', { panel: PANEL.viewport, tool: manip }, { panel: PANEL.viewport });
      }
    })();
  };

  return (
    <div
      className="flex h-[var(--size-statusline)] shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-header px-2"
      role="toolbar"
      aria-label="Status line"
      data-testid="statusline"
    >
      <Group label="Tools">
        <ToggleGroup
          type="single"
          value={tool}
          onValueChange={(value) => {
            if (value !== '') run('view.tool', { panel: PANEL.viewport, tool: value });
          }}
        >
          {tools.map((entry) => {
            const Icon = TOOL_ICONS[entry.id];
            return (
              <Tip
                key={entry.id}
                text={`${entry.label} tool`}
                shortcut={shortcutFor(app.keymap, 'view.tool', { panel: PANEL.viewport, tool: entry.id })}
              >
                <ToggleGroupItem
                  value={entry.id}
                  aria-label={`${entry.label} tool`}
                  data-testid={`status-tool-${entry.id}`}
                >
                  {Icon === undefined ? entry.label : <Icon />}
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>
      </Group>
      <Group label="Move space">
        <span className="text-ui-dense text-fg-3">Move</span>
        <ToggleGroup type="single" value={moveSpace} onValueChange={(value) => setSpace('move', value)}>
          {(['object', 'world'] as const).map((space) => {
            const Icon = SPACE_ICONS[space];
            return (
              <Tip key={space} text={`Move in ${SPACE_LABELS[space].toLowerCase()} space`}>
                <ToggleGroupItem
                  value={space}
                  aria-label={`Move: ${SPACE_LABELS[space]}`}
                  data-testid={`status-move-space-${space}`}
                >
                  <Icon />
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>
      </Group>
      <Group label="Rotate space">
        <span className="text-ui-dense text-fg-3">Rotate</span>
        <ToggleGroup type="single" value={rotateSpace} onValueChange={(value) => setSpace('rotate', value)}>
          {(['object', 'world', 'gimbal'] as const).map((space) => {
            const Icon = SPACE_ICONS[space];
            return (
              <Tip key={space} text={`Rotate in ${SPACE_LABELS[space].toLowerCase()} space`}>
                <ToggleGroupItem
                  value={space}
                  aria-label={`Rotate: ${SPACE_LABELS[space]}`}
                  data-testid={`status-rotate-space-${space}`}
                >
                  <Icon />
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>
      </Group>
      <Group label="Selection mask">
        <span className="text-ui-dense text-fg-3">Pick</span>
        {(
          [
            ['controls', 'Controls', <DisplayControlsIcon key="c" />],
            ['joints', 'Joints', <Bone key="j" size={16} />],
            ['meshes', 'Meshes', <Box key="m" size={16} />],
          ] as const
        ).map(([key, label, icon]) => (
          <Tip key={key} text={`Select ${label.toLowerCase()} in the viewport`}>
            <Toggle
              pressed={mask[key]}
              aria-label={`Pick ${label}`}
              data-testid={`status-mask-${key}`}
              onPressedChange={(pressed) => run('view.selectionMask', { mask: { [key]: pressed } })}
            >
              {icon}
            </Toggle>
          </Tip>
        ))}
      </Group>
      <Group label="Key target">
        <span className="text-ui-dense text-fg-3">Key</span>
        <ToggleGroup
          type="single"
          value={keyTarget}
          onValueChange={(value) => {
            if (value !== '') run('key.setTarget', { target: value });
          }}
        >
          {KEY_TARGETS.map((entry) => {
            const poll = app.operators.poll('key.setTarget', { panel: PANEL.viewport }, { target: entry.target });
            const reason = poll === true ? null : poll.reason;
            return (
              <Tip key={entry.target} text={reason === null ? entry.label : `${entry.label} (${reason})`}>
                <ToggleGroupItem
                  value={entry.target}
                  aria-label={entry.label}
                  data-testid={`status-keytarget-${entry.target}`}
                  disabled={reason !== null && entry.target !== keyTarget}
                >
                  <span className="text-ui">{entry.short}</span>
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>
      </Group>
      {/* M2a Tween bar slot (M2A-SPEC §7): A4 mounts the compact bar here. */}
      <div className="contents" data-testid="status-tween-slot">
        <TweenBar panel="status" />
      </div>
      <Group label="Keying">
        <Tip text="Auto key" shortcut={shortcutFor(app.keymap, 'key.toggleAutoKey', undefined)}>
          <Toggle
            pressed={autoKey}
            aria-label="Auto key"
            data-testid="status-autokey"
            onPressedChange={() => run('key.toggleAutoKey')}
            className="aria-pressed:text-autokey! aria-pressed:shadow-[inset_0_-2px_0_var(--autokey)]!"
          >
            <AutoKeyIcon />
            <span className="text-ui">Auto key</span>
          </Toggle>
        </Tip>
      </Group>
      {/* M-AI (MCP-SPEC §7.1, §7.5): the agent pill, before the layout buttons. D0 placeholder: "AI" (muted) opens
          the Agent panel; P8 shows the live state through the lazy agent chunk. */}
      <Group label="AI agent">
        <Tip text="AI agent (Windows › Agent)">
          <button
            type="button"
            className="rounded px-1.5 text-ui text-fg-3 hover:bg-hover hover:text-fg"
            data-testid="status-agent"
            onClick={() => void shell.runFromUi('workspace.showPanel', { panel: 'agent' })}
          >
            AI
          </button>
        </Tip>
      </Group>
      <Group label="Viewport layout">
        <ToggleGroup
          type="single"
          value={layout}
          onValueChange={(value) => {
            if (value !== '') run('view.layout', { layout: value });
          }}
        >
          {LAYOUTS.map((entry) => {
            const Icon = LAYOUT_ICONS[entry.layout];
            return (
              <Tip key={entry.layout} text={entry.label}>
                <ToggleGroupItem
                  value={entry.layout}
                  aria-label={entry.label}
                  data-testid={`status-layout-${entry.layout}`}
                >
                  {Icon === undefined ? entry.layout : <Icon />}
                </ToggleGroupItem>
              </Tip>
            );
          })}
        </ToggleGroup>
      </Group>
    </div>
  );
}
