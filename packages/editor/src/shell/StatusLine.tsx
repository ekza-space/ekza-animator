// Status line / tool strip (research 09 §4.2, M2A-SPEC §7): viewport tools, move and rotate manipulator spaces
// (incl. gimbal), selection mask, key target (M2a), the Tween bar slot (M2a, A4 mounts the bar), auto-key and the
// viewport layout preset. Every control runs an operator.
// M6a (M6A-SPEC §8.2; B9): the groups and their order come from the active workspace's `statusGroups` (Animate's are
// the shipped ones); Model adds the mode, symmetry, soft-selection, snapping and pivot groups (./statusGroups.tsx).
import {
  ANIMATE_STATUS_GROUPS,
  type KeyTarget,
  PANEL,
  VIEWPORT_TOOL,
  type ManipSpace,
  type ViewportLayout,
} from '@ekza-studio/editor-core';
import {
  AutoKeyIcon,
  Bone,
  Box,
  DisplayControlsIcon,
  type IconComponent,
  LAYOUT_ICONS,
  MoveToolIcon,
  RotateToolIcon,
  ScaleToolIcon,
  SelectToolIcon,
  SpaceGimbalIcon,
  SpaceObjectIcon,
  SpaceWorldIcon,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
} from '@ekza-studio/ui';
import {
  Fragment,
  type JSX,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { agentPill, subscribeAgentPill } from '../agent/ui/slot';
import { usePrefs, useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { TweenBar } from '../panels/shared/TweenBar';
import { useShell, useShellUi } from './context';
import { RIG_LAYOUTS } from './rig/layouts';
import { shortcutFor } from './menus';

/** M-AI (§7.1): `?agentPort=` opens the Agent panel once per page (the panel applies the port rules). */
let agentPortHandled = false;

/** M-AI (§7.5): the muted "AI" pill until the lazy agent module puts its live pill in the slot. */
function AgentPillSlot({ open }: { readonly open: () => void }): JSX.Element {
  const live = useSyncExternalStore(subscribeAgentPill, agentPill, agentPill);
  useEffect(() => {
    if (agentPortHandled || typeof location === 'undefined' || !/[?&]agentPort=/.test(location.search)) return;
    agentPortHandled = true;
    open();
  }, [open]);
  if (live !== null) return live;
  return (
    <Tip text="AI agent (Windows › Agent)">
      <button
        type="button"
        className="rounded px-1.5 text-ui text-fg-3 hover:bg-hover hover:text-fg"
        data-testid="status-agent"
        onClick={open}
      >
        AI
      </button>
    </Tip>
  );
}

/** Model's groups (mode, symmetry, soft selection, snapping, pivot): a lazy chunk, drawn only in Model. */
const ModelStatusGroup = lazy(() => import('./statusGroups').then((module) => ({ default: module.ModelStatusGroup })));

const TOOL_ICONS: Readonly<Record<string, IconComponent>> = {
  [VIEWPORT_TOOL.select]: SelectToolIcon,
  [VIEWPORT_TOOL.move]: MoveToolIcon,
  [VIEWPORT_TOOL.rotate]: RotateToolIcon,
  [VIEWPORT_TOOL.scale]: ScaleToolIcon,
};
/** The viewport tools the status line offers (Q W E R); the modeling tools live in the Toolkit and menus. */
const STATUS_TOOLS: ReadonlySet<string> = new Set([
  VIEWPORT_TOOL.select,
  VIEWPORT_TOOL.move,
  VIEWPORT_TOOL.rotate,
  VIEWPORT_TOOL.scale,
]);
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
/** Model's presets (§8.2): M-Single, M-Quad, M-Side (`front | persp`). */
const MODEL_LAYOUTS: readonly { readonly layout: ViewportLayout; readonly label: string }[] = [
  { layout: 'single', label: 'Single view' },
  { layout: 'quad', label: 'Four views' },
  { layout: 'split', label: 'Front | perspective' },
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

  const workspaceId = useSession((s) => s.workspace);
  const workspaces = useRegistryList(app.workspaces);
  const groups = workspaces.find((def) => def.id === workspaceId)?.statusGroups ?? ANIMATE_STATUS_GROUPS;
  const model = workspaceId === 'model';
  const registered = app.tools
    .list(PANEL.viewport)
    .filter((def) => STATUS_TOOLS.has(def.id))
    .map((def) => ({ id: def.id, label: def.label }));
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

  /** The groups by id (M6a: the workspace orders and picks them). */
  const render = (id: string): JSX.Element | null => {
    switch (id) {
      case 'tools':
        return (
          <Group key="tools" label="Tools">
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
        );
      case 'moveSpace':
        return (
          <Group key="moveSpace" label="Move space">
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
        );
      case 'rotateSpace':
        return (
          <Group key="rotateSpace" label="Rotate space">
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
        );
      case 'selectionMask':
        return (
          <Group key="selectionMask" label="Selection mask">
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
        );
      case 'keyTarget':
        return (
          <Group key="keyTarget" label="Key target">
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
        );
      case 'keying':
        return (
          <Fragment key="keying">
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
          </Fragment>
        );
      case 'layout':
        return (
          <Group key="layout" label="Viewport layout">
            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(value) => {
                if (value !== '') run('view.layout', { layout: value });
              }}
            >
              {(model ? MODEL_LAYOUTS : workspaceId === 'rig' ? RIG_LAYOUTS : LAYOUTS).map((entry) => {
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
        );
      default:
        return (
          <Suspense key={id} fallback={null}>
            <ModelStatusGroup id={id} />
          </Suspense>
        );
    }
  };

  const openAgentPanel = useCallback(() => void shell.runFromUi('workspace.showPanel', { panel: 'agent' }), [shell]);
  const agentGroup = (
    <Group key="agent" label="AI agent">
      <AgentPillSlot open={openAgentPanel} />
    </Group>
  );

  return (
    <div
      className="flex h-[var(--size-statusline)] shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-header px-2"
      role="toolbar"
      aria-label="Status line"
      data-testid="statusline"
    >
      {/* M-AI (MCP-SPEC §7.1, §7.5): the agent pill sits before the layout buttons in every workspace (not a
          workspace status group, so the workspaces' group lists stay as shipped). "AI" (muted) opens the Agent panel
          until the lazy agent module puts its live pill in the slot (B3). */}
      {groups.flatMap((id) => (id === 'layout' ? [agentGroup, render(id)] : [render(id)]))}
      {groups.includes('layout') ? null : agentGroup}
    </div>
  );
}
