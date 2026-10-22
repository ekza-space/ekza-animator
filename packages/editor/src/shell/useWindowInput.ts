// Window-level listeners of the DOM input adapter (MVP-SPEC §7 WP-8): keymap dispatch, hovered panel tracking,
// Space tap/hold, blur/visibility reset, browser-default suppression (MMB autoscroll and paste, context menu,
// pinch-zoom), global drag-and-drop of files and the unsaved-changes guard. The page's host installs them once
// (AUTORIG-SPEC §4.4): they serve both shells.
import { type RefObject, useEffect } from 'react';
import { isClosedMenuTrigger, isDropdown, isInOverlay, isTextEntry, menuTriggerKeyRoute } from '../input/focus';
import { keyInputOf } from '../input/keyboard';
import { hoverTargetOf, sameHover } from '../input/pointer';
import { prefetchForFileDrag, prefetchModelLoading, SAMPLE_SELECTOR } from './prefetch';
import type { HostShell } from '../host/types';

const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true;

/** Installs the listeners while mounted. `root` is the editor's root element (context menu and wheel scope). */
export function useWindowInput(shell: HostShell, root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const { app, ui, keyboard } = shell;
    const inEditor = (target: EventTarget | null): boolean =>
      target instanceof Node && root.current !== null && root.current.contains(target);

    const setHover = (target: EventTarget | null, x: number, y: number): void => {
      const vm = ui.getState().viewport;
      const hover = hoverTargetOf(target, x, y, vm === null ? null : (cx, cy) => vm.paneAt(cx, cy));
      const state = ui.getState();
      if (sameHover(hover, state.hover)) return;
      ui.setState({ hover, lastPanel: hover ?? state.lastPanel });
      const previous = app.session.getState().hoveredPanel;
      const next = hover === null ? null : { kind: hover.kind, paneId: hover.paneId };
      if (previous?.kind !== next?.kind || previous?.paneId !== next?.paneId)
        app.session.setState({ hoveredPanel: next });
    };

    // The dropdown the pointer last pressed: a value chosen with the pointer hands the keyboard back to the editor
    // (acceptance round 2, §4.10 "Keyboard focus"); keyboard use of the dropdown keeps its focus.
    let pointerDropdown: HTMLSelectElement | null = null;
    const onChange = (event: Event): void => {
      const target = event.target;
      if (!isDropdown(target) || target !== pointerDropdown) return;
      pointerDropdown = null;
      if (!inEditor(target) || isInOverlay(target) || document.activeElement !== target) return;
      target.blur();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target === pointerDropdown) pointerDropdown = null;
      if (event.defaultPrevented) return;
      keyboard.keyDown(event);
    };
    // A focused trigger of a closed menu does not own the keyboard (§4.10, acceptance round 3): the keys it leaves
    // to the editor must not reach its own handler (Radix reopens the menu on Space, Enter and ArrowDown), so they are
    // taken on the document in the capture phase, after the panels' window-level capture listeners (a drag's Esc).
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      const target = event.target;
      if (event.defaultPrevented || !isClosedMenuTrigger(target) || !inEditor(target)) return;
      if (menuTriggerKeyRoute(target, keyInputOf(event)) !== 'editor') return;
      event.stopPropagation();
      onKeyDown(event);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      keyboard.keyUp(event);
    };
    const onPointerMove = (event: PointerEvent): void => setHover(event.target, event.clientX, event.clientY);
    // Intent prefetch (M2A-SPEC §5.21.2): hovering or pressing a sample button starts loading the model loader.
    let samplePrefetched = false;
    const onPointerOver = (event: PointerEvent): void => {
      if (samplePrefetched || !(event.target instanceof Element) || event.target.closest(SAMPLE_SELECTOR) === null) {
        return;
      }
      samplePrefetched = true;
      prefetchModelLoading();
    };
    const onPointerDown = (event: PointerEvent): void => {
      onPointerOver(event);
      pointerDropdown = isDropdown(event.target) ? event.target : null;
      setHover(event.target, event.clientX, event.clientY);
      keyboard.pointerActivity();
      // Middle button: no autoscroll (Windows) and no primary-selection paste (Linux) inside the editor.
      if (event.button === 1 && inEditor(event.target)) event.preventDefault();
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 1 && inEditor(event.target)) event.preventDefault();
    };
    const onAuxClick = (event: MouseEvent): void => {
      if (event.button === 1 && inEditor(event.target)) event.preventDefault();
    };
    // Runs after React's handlers (window, bubble): panels' own context menus have already handled the event.
    const onContextMenu = (event: MouseEvent): void => {
      if (event.defaultPrevented || !inEditor(event.target) || isTextEntry(event.target)) return;
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent): void => {
      // Trackpad pinch arrives as ctrl+wheel: never zoom the page inside the editor.
      if (event.ctrlKey && inEditor(event.target)) event.preventDefault();
    };
    const onPointerLeaveWindow = (event: PointerEvent): void => {
      if (event.relatedTarget === null) setHover(null, 0, 0);
    };
    const onBlur = (): void => keyboard.reset();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') keyboard.reset();
    };

    let dragDepth = 0;
    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (dragDepth === 0) {
        prefetchForFileDrag();
        shell.files.preload?.();
      }
      dragDepth += 1;
      if (!ui.getState().dragOver) ui.setState({ dragOver: true });
    };
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0 || event.relatedTarget === null) {
        dragDepth = 0;
        ui.setState({ dragOver: false });
      }
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      ui.setState({ dragOver: false });
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void shell.files.openFiles(files);
    };

    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (shell.params.e2e || !app.session.getState().dirty) return;
      event.preventDefault();
      // Legacy browsers show the prompt only when returnValue is set.
      event.returnValue = '';
    };

    const rootElement = root.current;
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onKeyDownCapture, { capture: true });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('change', onChange);
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('auxclick', onAuxClick, { capture: true });
    window.addEventListener('contextmenu', onContextMenu);
    document.documentElement.addEventListener('pointerleave', onPointerLeaveWindow);
    rootElement?.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onKeyDownCapture, { capture: true });
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('change', onChange);
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerover', onPointerOver, { capture: true });
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('auxclick', onAuxClick, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu);
      document.documentElement.removeEventListener('pointerleave', onPointerLeaveWindow);
      rootElement?.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
      keyboard.reset();
    };
  }, [shell, root]);
}
