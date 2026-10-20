# Layout presets for focused work

Owner request, 2026-10-20 (TODO "Layout presets for focused work"). Built on the M6a workspace and layout system
(M6A-SPEC §4.8, §5.17): every workspace keeps its own dock layout, and now also its own chrome and presets.

## What a preset is

A preset is three things, applied together:

1. **Dock layout**: which panels are docked and where (dockview JSON).
2. **Chrome**: whether the workspace shows the **tool strip** (the status line under the menu bar), the **help line**
   and the **time slider**. The menu bar and the workspace tabs always stay, so every preset can be undone from the
   Windows menu.
3. **Viewport panes**: single, split or quad, and the maximized pane.

## Built-in presets (Windows › Presets)

| Key | Preset | Docks | Chrome | Panes |
|---|---|---|---|---|
| `Alt+1` | Animate (default) | the workspace's default layout | the workspace's defaults | the workspace's default (Animate: split; Model: quad, persp maximized) |
| `Alt+2` | Blocking | the viewport only | tool strip, help line, time slider | single |
| `Alt+3` | Polish | the viewport over a large Graph Editor (55 % of the dock height; Dope Sheet as its inactive tab) | tool strip, help line, time slider | single |
| `Alt+4` | Review | the viewport only, across the window | the time slider with its playback controls only | single |

Blocking, Polish and Review are Animate presets: in Model they poll-fail with a hint, and `Alt+1` restores Model's
default layout (Windows › Presets › Default Layout there).

## Chrome toggles (Windows menu)

Windows › **Tool Strip**, **Help Line**, **Time Slider** are check-box items (`workspace.toggleChrome {part}`,
`workspace.toggleTimeline`). They act on the active workspace only and are stored with its layout
(`ekza-animator:layout:v<N>:<workspace>`, fields `chrome` and `focus`, additive: no layout version bump). Windows ›
Reset Workspace restores the default chrome too.

## Focus mode

`Ctrl+Space` (Maya's "hide UI") or `Alt+0`, Windows › Focus Mode (`workspace.toggleFocus`): the panels around the
viewport and the tool strip and help line hide, and the viewport takes the whole dock area. Pressing it again restores
the dock layout and chrome exactly as they were (the snapshot is kept per workspace and stored with the layout, so it
also survives a reload). The time slider and the viewport panes are left as they are. Applying a preset or Reset
Workspace ends focus mode.

**Why `Alt+0` as well.** macOS uses `Ctrl+Space` to switch the input source as soon as more than one input source is
set up (System Settings › Keyboard › Keyboard Shortcuts › Input Sources), and on Windows a Chinese IME toggles on it; the
browser then never sees the key. `Alt+0` works everywhere (`⌥0` on a Mac; Alt+digit is not a dead key on common
layouts). `Space` is a tap/hold key in the editor, so `Ctrl+Space` runs on the tap; holding it does nothing. MVP-SPEC
§4.10 used to list `Ctrl+Space` as never bound: it is bound now, with `Alt+0` as the documented alternative.

## User presets

Windows › Presets › **Save Current Layout as…** asks for a name and saves the current dock layout, chrome and panes as
a preset of the active workspace (`workspace.preset.save {name}`; saving under an existing name, any case, replaces
it). Saved presets are listed in Windows › Presets and apply from there (`workspace.preset.apply {preset: <id>}`).
**Rename or Delete Presets…** opens the same dialog with the list (Apply, Rename, Delete;
`workspace.preset.rename {id, name}`, `workspace.preset.delete {id}`).

Storage: `ekza-animator:presets:v1:<workspace>` in the editor's preference storage (localStorage, namespaced like the
layouts), `{schemaVersion: 1, workspace, presets: [...]}`. Unreadable entries are dropped; a broken or newer file reads
as no presets. When the browser blocks storage (or a write fails) presets still work until the page reloads and the
dialog says so.

## Full screen

`Shift+F` or Windows › Full Screen (`view.toggleFullscreen`) uses the browser Fullscreen API on the whole editor;
pressing it again (or Esc, the browser's own exit) leaves full screen. `F11` stays the browser's own full screen and is
never bound.

## Keymap check

All rows are global (`*`) and use `KeyboardEvent.code`:

| Chord | Operator | Notes |
|---|---|---|
| `Ctrl+Space` (tap) | `workspace.toggleFocus` | literal Ctrl on every platform; the OS may take it first (above) |
| `Alt+Digit0` | `workspace.toggleFocus` | the alternative |
| `Alt+Digit1`…`Alt+Digit4` | `workspace.preset.apply {preset: 'animate'/'blocking'/'polish'/'review'}` | Firefox on Linux switches tabs on Alt+digit; the editor prevents the default while it has the keyboard |
| `Shift+KeyF` | `view.toggleFullscreen` | `F`/`Alt+F` are untouched (frame; browser menu on Windows) |

None of these chords was bound before in any scope (`Alt+Digit*`, `Shift+F`, `Ctrl+Space`), none is in the never-bound
list of M6A-SPEC §7's conformance test, and the M2a Animate snapshot test names them as the only added answers.
