// GLHost (ADR 0006 §1, ARCHITECTURE §10): one R3F <Canvas frameloop="demand"> fixed behind the workspace. On
// creation it hands the renderer to the model loader (before any load), creates the ViewportManager, registers the
// viewport contributions and wires `app.requestFrame` to R3F's invalidate. Each frame: `addEffect` runs the clock
// and evaluation, `useFrame(…, 1)` renders the dirty panes, `addAfterEffect` redraws the 2D canvases. Context
// loss is reported and recovered; without WebGL the editor keeps running on the fallback frame scheduler.
import { EkzaError } from '@ekza-animator/anim-core';
import { registerViewportContributions, ViewportManager, viewportTestApi } from '@ekza-animator/viewport';
import { addAfterEffect, addEffect, Canvas, type RootState, useFrame } from '@react-three/fiber';
import { Component, type ErrorInfo, type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { useShell } from '../shell/context';
import type { Shell } from '../shell/types';
import { createFrameGate, type FrameGate } from './frameGate';
import { probeWebGl, rendererName } from './webgl';

const CLEAR_COLOR = '#1b1c1f';
/** Toast while the WebGL context is lost; dismissed when it comes back (acceptance round 1). */
export const CONTEXT_LOST_TEXT = 'The graphics context was lost; restoring the 3D view…';
export const CONTEXT_RESTORED_TEXT = 'The 3D view was restored.';

function isNotImplemented(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'not-implemented';
}

/** Renders every demanded frame: the ViewportManager's dirty panes, or the empty R3F scene without one. */
function FrameDriver(props: { readonly shell: Shell; readonly gate: FrameGate }): null {
  useFrame((state) => {
    props.gate.enter('render');
    props.shell.countFrame();
    const vm = props.shell.ui.getState().viewport;
    if (vm !== null) vm.render();
    else state.gl.render(state.scene, state.camera);
    // Requested during this frame (playback, a callback asking for more): keep the demand loop going.
    if (props.gate.takeContinuation()) state.invalidate();
  }, 1);
  return null;
}

interface BoundaryProps {
  readonly onError: (error: unknown) => void;
  readonly children: ReactNode;
}

/** Turns a failed WebGL context creation into the "WebGL unavailable" state instead of a crashed editor. */
class CanvasBoundary extends Component<BoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Ekza Animator: the WebGL canvas failed to start', error, info.componentStack);
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Sets up the viewport for a created GL root; returns its teardown. */
function attachRenderer(shell: Shell, state: RootState, gate: FrameGate): () => void {
  const { app, ui } = shell;
  const gl = state.gl;
  gl.setClearColor(CLEAR_COLOR, 1);

  try {
    app.services.models?.setRenderer(gl);
  } catch (error) {
    if (!isNotImplemented(error)) console.error('Ekza Animator: the model loader rejected the renderer', error);
  }

  let vm: ViewportManager | null = null;
  try {
    vm = new ViewportManager({ app, renderer: gl });
  } catch (error) {
    if (!isNotImplemented(error)) console.error('Ekza Animator: the viewport could not start', error);
  }
  let disposeContributions: () => void = () => {};
  if (vm !== null) {
    try {
      disposeContributions = registerViewportContributions(app, vm);
    } catch (error) {
      // Another host already registered the viewport tools and operators; keep rendering with this manager.
      console.error('Ekza Animator: the viewport contributions could not be registered', error);
    }
  }
  // The viewport slice of the e2e test API (MVP-SPEC §4.8): panes, cameras and screen points from this manager.
  const disposeProbe = vm === null ? () => {} : shell.probes.set('viewport', viewportTestApi(vm));
  let unsubscribePrefs: (() => void) | null = null;
  if (vm !== null) {
    const manager = vm;
    manager.setNavProfile(app.prefs.getState().navProfile);
    unsubscribePrefs = app.prefs.subscribe((prefs, previous) => {
      if (prefs.navProfile !== previous.navProfile) manager.setNavProfile(prefs.navProfile);
    });
  }

  const renderer = rendererName(gl.getContext());
  gate.bind(() => state.invalidate());
  app.setFrameRequester(() => gate.request());
  ui.setState({ viewport: vm, gl: { status: 'ready', renderer } });

  const canvas = gl.domElement;
  const onLost = (event: Event): void => {
    event.preventDefault();
    ui.setState({ gl: { status: 'lost', renderer } });
    app.services.notify.toast({ kind: 'warning', text: CONTEXT_LOST_TEXT });
  };
  const onRestored = (): void => {
    ui.setState({ gl: { status: 'ready', renderer } });
    // The "restoring…" warning no longer holds: replace it with a short confirmation.
    shell.toasts?.dismissWhere((toast) => toast.text === CONTEXT_LOST_TEXT);
    app.services.notify.toast({ kind: 'success', text: CONTEXT_RESTORED_TEXT });
    vm?.invalidate();
    state.invalidate();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  state.invalidate();

  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    unsubscribePrefs?.();
    disposeProbe();
    disposeContributions();
    gate.bind(null);
    shell.restoreFallbackFrames();
    if (ui.getState().viewport === vm) ui.setState({ viewport: null });
    try {
      vm?.dispose();
    } catch (error) {
      console.error('Ekza Animator: disposing the viewport failed', error);
    }
  };
}

export function GLHost(): JSX.Element | null {
  const shell = useShell();
  const [webgl] = useState(probeWebGl);
  const [failed, setFailed] = useState(false);
  const teardown = useRef<(() => void) | null>(null);
  const [gate] = useState(createFrameGate);
  const available = webgl.ok && !failed;

  useEffect(() => {
    if (!available) shell.ui.setState({ viewport: null, gl: { status: 'unavailable', renderer: webgl.renderer } });
  }, [available, shell, webgl]);

  // Frame effects are global to R3F's loop; they run only while a frame is being rendered (demand mode).
  useEffect(() => {
    if (!available) return undefined;
    const offBefore = addEffect((timestamp) => {
      gate.enter('before');
      shell.frame.runBefore(timestamp);
    });
    const offAfter = addAfterEffect((timestamp) => {
      gate.enter('after');
      shell.frame.runAfter(timestamp);
      gate.enter('idle');
    });
    return () => {
      offBefore();
      offAfter();
    };
  }, [available, shell, gate]);

  useEffect(
    () => () => {
      teardown.current?.();
      teardown.current = null;
    },
    [],
  );

  if (!available) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden data-testid="gl-host">
      <CanvasBoundary onError={() => setFailed(true)}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          style={{ pointerEvents: 'none' }}
          onCreated={(state) => {
            teardown.current?.();
            teardown.current = attachRenderer(shell, state, gate);
          }}
        >
          <FrameDriver shell={shell} gate={gate} />
        </Canvas>
      </CanvasBoundary>
    </div>
  );
}
