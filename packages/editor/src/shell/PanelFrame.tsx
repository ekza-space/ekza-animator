// The frame every panel renders in: key-scope and hover attributes for the input adapter, and an error boundary so
// a failing panel shows a message instead of taking the editor down.
import type { EditorApp, KeyScope, PanelKind } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { INSTANCE_ATTR, PANEL_ATTR, SCOPE_ATTR } from '../input/pointer';
import type { PanelDef } from '../panels/types';

export interface PanelFrameProps {
  readonly kind: PanelKind;
  readonly scope: KeyScope;
  readonly instanceId: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function PanelFrame(props: PanelFrameProps): JSX.Element {
  const attrs = {
    [PANEL_ATTR]: props.kind,
    [SCOPE_ATTR]: props.scope,
    [INSTANCE_ATTR]: props.instanceId,
  };
  return (
    <div
      {...attrs}
      data-testid={`panel-${props.instanceId}`}
      className={
        props.kind === PANEL.viewport
          ? `ekza-panel ekza-panel--transparent relative h-full w-full overflow-hidden ${props.className ?? ''}`
          : `ekza-panel relative h-full w-full overflow-hidden bg-panel ${props.className ?? ''}`
      }
    >
      <PanelErrorBoundary title={props.title}>{props.children}</PanelErrorBoundary>
    </div>
  );
}

/** Renders a registered panel's component inside its frame. */
export function RegisteredPanel(props: {
  readonly def: PanelDef;
  readonly app: EditorApp;
  readonly instanceId: string;
  readonly className?: string;
}): JSX.Element {
  const Panel = props.def.component;
  return (
    <PanelFrame
      kind={props.def.kind}
      scope={props.def.keyScope}
      instanceId={props.instanceId}
      title={props.def.title}
      {...(props.className === undefined ? {} : { className: props.className })}
    >
      <Panel app={props.app} instanceId={props.instanceId} />
    </PanelFrame>
  );
}

/** Shown for a panel kind of the Animate layout that this build does not register yet. */
export function PlaceholderPanel(props: {
  readonly kind: PanelKind;
  readonly title: string;
  readonly instanceId: string;
}): JSX.Element {
  return (
    <PanelFrame kind={props.kind} scope={props.kind} instanceId={props.instanceId} title={props.title}>
      <div
        className="grid h-full place-items-center p-4 text-center text-ui text-fg-3"
        data-testid={`placeholder-${props.kind}`}
      >
        <p>{props.title} is not available in this build.</p>
      </div>
    </PanelFrame>
  );
}

interface BoundaryState {
  readonly error: unknown;
}

class PanelErrorBoundary extends Component<{ readonly title: string; readonly children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`Ekza Studio: the ${this.props.title} panel failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const { error } = this.state;
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-ui">
        <p className="font-semibold text-danger">{this.props.title} stopped working</p>
        <p className="max-w-md text-fg-3">{message}</p>
        <button
          type="button"
          className="rounded-button border border-line-strong px-2 py-0.5 text-fg-2 hover:bg-hover"
          onClick={() => this.setState({ error: null })}
        >
          Reload panel
        </button>
      </div>
    );
  }
}
