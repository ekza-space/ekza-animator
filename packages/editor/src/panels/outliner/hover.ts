// Outliner hover → viewport pre-highlight (FR-OUT-03): the Outliner writes `session.hoverControl` (v0.3 integration,
// WP-9 R-2) and the viewport draws that control with the hover style while the pointer hovers no control in a pane.
import type { ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';

export function hoveredControl(app: EditorApp): ControlId | null {
  return app.session.getState().hoverControl;
}

export function setHoveredControl(app: EditorApp, control: ControlId | null): void {
  if (hoveredControl(app) === control) return;
  app.session.setState({ hoverControl: control });
}
