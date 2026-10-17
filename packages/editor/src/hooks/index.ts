// React bindings of the EditorApp (MVP-SPEC §7 WP-8 public API; built by the shared test kit, WP-0b) and the shell
// hooks panels use to reach the GL host, the frame loop, the help line and the e2e test API.
import type { Prefs, SessionState } from '@ekza-animator/editor-core';
import { useEditorApp } from './context';
import { useStoreSelector } from './useStoreSelector';

export { EditorAppProvider, useEditorApp } from './context';
export { useFrameCallback, useHelpLine, useTestProbe, useViewportManager } from './shell';
export { useDocQuery } from './useDocQuery';

/** Selected session (U) state; re-renders only when the selection changes under `equality` (default `Object.is`). */
export function useSession<T>(selector: (s: SessionState) => T, equality?: (a: T, b: T) => boolean): T {
  return useStoreSelector(useEditorApp().session, selector, equality);
}

/** Selected preferences (P state); re-renders only when the selected value changes (`Object.is`). */
export function usePrefs<T>(selector: (p: Prefs) => T): T {
  return useStoreSelector(useEditorApp().prefs, selector);
}
