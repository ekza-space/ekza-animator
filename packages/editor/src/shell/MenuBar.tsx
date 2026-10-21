// Menu bar (research 09 §4.1): menus from the menu registry, enabled state from operator polls evaluated when a
// menu opens, shortcut labels from the keymap. Commands run in the context of the last hovered panel.
import type { RunContext } from '@ekza-studio/editor-core';
import {
  AppMarkIcon,
  Button,
  Download,
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
  MenuShortcut,
} from '@ekza-studio/ui';
import { Fragment, type JSX, useEffect } from 'react';
import { useSession } from '../hooks';
import { useRegistryList } from '../hooks/useRegistry';
import { useShell } from './context';
import { type MenuSection, menuContents, topMenus } from './menus';
import { prefetchForMenuItems } from './prefetch';
import type { Shell } from './types';
import { WorkspaceTabs } from './WorkspaceTabs';

function menuContext(shell: Shell): RunContext {
  const last = shell.ui.getState().lastPanel;
  return {
    ...(last === null ? {} : { panel: last.kind }),
    ...(last === null || last.paneId === null ? {} : { paneId: last.paneId }),
    source: 'menu',
  };
}

function Sections(props: { readonly shell: Shell; readonly sections: readonly MenuSection[] }): JSX.Element {
  return (
    <>
      {props.sections.map((section, index) => (
        <Fragment key={section.group}>
          {index === 0 ? null : <MenubarSeparator />}
          {section.items.map((item) =>
            item.checked === null ? (
              <MenubarItem
                key={item.id}
                data-testid={`menu-item-${item.id}`}
                disabled={item.disabledReason !== null}
                title={item.disabledReason ?? undefined}
                onSelect={() => {
                  void props.shell.runFromUi(item.op, item.args, menuContext(props.shell));
                }}
              >
                <span className="truncate">{item.label}</span>
                {item.shortcut === null ? null : <MenuShortcut>{item.shortcut}</MenuShortcut>}
              </MenubarItem>
            ) : (
              // Check-box items (Windows › Tool Strip, Focus Mode…): ticked as they were when the menu opened.
              <MenubarCheckboxItem
                key={item.id}
                data-testid={`menu-item-${item.id}`}
                checked={item.checked}
                disabled={item.disabledReason !== null}
                title={item.disabledReason ?? undefined}
                onSelect={() => {
                  void props.shell.runFromUi(item.op, item.args, menuContext(props.shell));
                }}
              >
                <span className="truncate">{item.label}</span>
                {item.shortcut === null ? null : <MenuShortcut>{item.shortcut}</MenuShortcut>}
              </MenubarCheckboxItem>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

/** Rendered only while its menu is open (Radix mounts content on open), so polls run at open time. */
function MenuContents(props: { readonly shell: Shell; readonly menuId: string }): JSX.Element {
  const { sections, submenus } = menuContents(props.shell.app, props.menuId, menuContext(props.shell));
  // Intent prefetch (M2A-SPEC §5.21.2): an open menu loads the chunks of its items' dialogs and file paths.
  useEffect(() => {
    prefetchForMenuItems([
      ...sections.flatMap((section) => section.items),
      ...submenus.flatMap((submenu) => submenu.sections.flatMap((section) => section.items)),
    ]);
    // oxlint-disable-next-line react/exhaustive-deps -- once per opening: Radix mounts the content when it opens
  }, []);
  return (
    <>
      <Sections shell={props.shell} sections={sections} />
      {submenus.map((submenu) => (
        <Fragment key={submenu.id}>
          {sections.length === 0 ? null : <MenubarSeparator />}
          <MenubarSub>
            <MenubarSubTrigger data-testid={`menu-sub-${submenu.id}`}>{submenu.label}</MenubarSubTrigger>
            <MenubarSubContent>
              <Sections shell={props.shell} sections={submenu.sections} />
            </MenubarSubContent>
          </MenubarSub>
        </Fragment>
      ))}
      {sections.length === 0 && submenus.length === 0 ? <MenubarItem disabled>Nothing here yet</MenubarItem> : null}
    </>
  );
}

export function MenuBar(): JSX.Element {
  const shell = useShell();
  const { app } = shell;
  const items = useRegistryList(app.menus);
  // M6a (§8.1): each workspace shows its own menu set (B0b's `topMenus`); Animate's is the shipped one.
  const workspaceId = useSession((s) => s.workspace);
  const workspaces = useRegistryList(app.workspaces);
  const menus = topMenus(items, { id: workspaceId, menus: workspaces.find((def) => def.id === workspaceId)?.menus });
  const projectName = useSession((s) => s.projectName);
  const dirty = useSession((s) => s.dirty);

  return (
    <header
      className="flex h-[var(--size-menubar)] shrink-0 items-center gap-2 border-b border-line bg-header px-2"
      data-testid="menubar"
    >
      <span className="flex items-center gap-1.5 pr-1 text-ui font-semibold text-fg" aria-label="Ekza Animator">
        <AppMarkIcon size={16} className="text-accent-text" />
        <span className="hidden sm:inline">Ekza Animator</span>
      </span>
      <Menubar aria-label="Main menu">
        {menus.map((menu) => (
          <MenubarMenu key={menu.id} value={menu.id}>
            <MenubarTrigger data-testid={`menu-${menu.id}`}>{menu.label}</MenubarTrigger>
            <MenubarContent>
              <MenuContents shell={shell} menuId={menu.id} />
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
      {/* M6A-SPEC §8.1: the workspace tabs sit right of the menus. */}
      <WorkspaceTabs />
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <span className="truncate text-ui text-fg-2" data-testid="project-title" title={projectName}>
          {projectName}
          {dirty ? <span className="text-fg-3"> ✱</span> : null}
        </span>
        <Button
          size="sm"
          variant="primary"
          data-testid="menubar-export"
          onClick={() => void shell.runFromUi('ui.open', { dialog: 'export' })}
        >
          <Download size={14} />
          Export
        </Button>
      </div>
    </header>
  );
}
