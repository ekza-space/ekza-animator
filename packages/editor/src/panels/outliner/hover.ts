// Outliner hover → viewport pre-highlight (FR-OUT-03). `SessionState` has no field for a hovered control yet;
// contract request R-2 (docs/wp-notes/wp-9.md) adds `hoverControl: ControlId | null` for the viewport to read.
// Until it lands the Outliner writes that field untyped, so the viewport can adopt it without a panel change.
import type { ControlId } from '@ekza-animator/doc';
import type { EditorApp, SessionState } from '@ekza-animator/editor-core';

type SessionWithHover = SessionState & { readonly hoverControl?: ControlId | null };

export function hoveredControl(app: EditorApp): ControlId | null {
  return (app.session.getState() as SessionWithHover).hoverControl ?? null;
}

export function setHoveredControl(app: EditorApp, control: ControlId | null): void {
  if (hoveredControl(app) === control) return;
  const patch: Pick<SessionWithHover, 'hoverControl'> = { hoverControl: control };
  app.session.setState(patch as Partial<SessionState>);
}
