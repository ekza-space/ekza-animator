// B0b (M6A-SPEC §7, §9 B0b "the cheat sheet lists every new binding"): the shortcut sheet shows each §7 row under
// its Model scope and documents the tool modifiers.
import { MAYA_KEYMAP, MODEL_SCOPE, registerBuiltinOperators, TOOL_MODIFIERS } from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import { DialogHost } from '../../src/dialogs/DialogHost';
import { shortcutRows, toolModifierRows } from '../../src/dialogs/ShortcutsDialog';
import { render, update } from '../render';
import { createTestShell, ShellFrame, waitFor } from '../shell-helpers';

const NEW_SCOPES = new Set<string>(Object.values(MODEL_SCOPE));

describe('shortcut sheet (M6a)', () => {
  it('lists every binding of the Model scopes and the new viewport and global rows', () => {
    const { app, shell } = createTestShell({ platform: 'other' });
    registerBuiltinOperators(app);
    const rows = shortcutRows(app);
    const rowOf = (scope: string, keys: string) => rows.filter((row) => row.scope === scope && row.keys === keys);
    const modelRows = MAYA_KEYMAP.filter((binding) => NEW_SCOPES.has(binding.scope));
    expect(modelRows.length).toBeGreaterThan(60);
    for (const binding of modelRows) {
      const keys = `${app.keymap.label(binding.chord)}${binding.trigger === 'tap' ? ' tap' : ''}`;
      expect([binding.scope, keys, rowOf(binding.scope, keys).length > 0]).toEqual([binding.scope, keys, true]);
    }
    expect(rowOf('global', 'Ctrl+Shift+E')).toEqual([
      { scope: 'global', keys: 'Ctrl+Shift+E', label: 'Open Dialog (export)', available: true },
    ]);
    expect(rowOf('model', 'Ctrl+E')[0]?.label).toBe('Extrude');
    expect(rowOf(MODEL_SCOPE.viewport, 'B tap')[0]?.label).toBe('Soft Select');
    expect(rowOf('viewport', '4')[0]?.label).toBe('Shading (wire)');
    shell.dispose();
  });

  it('documents the tool modifiers with platform labels', () => {
    const other = createTestShell({ platform: 'other' });
    const mac = createTestShell({ platform: 'mac' });
    const rows = toolModifierRows(other.app);
    expect(rows).toHaveLength(TOOL_MODIFIERS.length);
    const keys = rows.map((row) => row.keys);
    expect(keys).toEqual(expect.arrayContaining(['X', 'V', 'J', 'D', 'B + LMB drag', 'B + MMB drag', 'I']));
    expect(keys).toEqual(expect.arrayContaining(['Ctrl + click', 'Shift + during a drag', 'PgUp / PgDn']));
    expect(toolModifierRows(mac.app).map((row) => row.keys)).toEqual(
      expect.arrayContaining(['⌃ + click', '⌘ + during a drag', '⌫']),
    );
    expect(rows.find((row) => row.keys === 'X')?.label).toBe('Move / Rotate / Scale: Snap to the grid while held');
    other.shell.dispose();
    mac.shell.dispose();
  });

  it('renders the Model scopes and the tool-modifier section in the dialog', async () => {
    const test = createTestShell({ platform: 'other' });
    registerBuiltinOperators(test.app);
    const view = await render(
      <ShellFrame shell={test.shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => test.shell.runFromUi('ui.open', { dialog: 'shortcuts' }));
    await waitFor(() => document.querySelector('[data-testid="shortcuts-tool-modifiers"]') !== null);
    const dialog = document.querySelector('[data-testid="shortcuts-dialog"]');
    const headings = [...(dialog?.querySelectorAll('h3') ?? [])].map((heading) => heading.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([
        'Model',
        'Model viewport',
        'Model viewport, component modes',
        'Model viewport, edge mode',
        'Model viewport, face mode',
        'Model Outliner',
        'Tool modifiers (Model viewport, while held)',
      ]),
    );
    const modifiers = document.querySelector('[data-testid="shortcuts-tool-modifiers"]');
    expect(modifiers?.textContent).toContain('Snap to vertices while held');
    await update(() => test.shell.runFromUi('ui.close'));
    await view.unmount();
    test.shell.dispose();
  });
});
