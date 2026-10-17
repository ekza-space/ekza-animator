// WP-0a placeholder of the editor root: one R3F canvas (render on demand) and the e2e test API with `ready`,
// `webgl` and `renderedFrames`. WP-8 replaces it with the shell (services, EditorApp, workspace, panels).
import { Canvas, type RootState, useFrame } from '@react-three/fiber';
import { Component, type ErrorInfo, type JSX, type ReactNode, useEffect, useState } from 'react';
import {
  createPlaceholderTestApi,
  isE2eRequested,
  type PlaceholderTestApi,
  probeWebGl,
  rendererName,
} from './test-api/placeholder';

export interface EditorProps {
  /** Default '/decoders/'. */
  readonly decoderPath?: string;
  /** Default '/samples/'. */
  readonly samplesPath?: string;
  /** M1-stretch. */
  readonly createValidatorWorker?: () => Worker;
  /** The build allows e2e mode (`NEXT_PUBLIC_EKZA_E2E=1`); the test API installs only with `?e2e=1` as well. */
  readonly e2e?: boolean;
}

export function Editor(props: EditorProps): JSX.Element {
  const [testApi] = useState<PlaceholderTestApi | null>(() =>
    isE2eRequested(props.e2e === true, window.location.search) ? createPlaceholderTestApi() : null,
  );
  const [webgl] = useState(probeWebGl);
  const [canvasFailed, setCanvasFailed] = useState(false);

  useEffect(() => {
    if (testApi === null) return undefined;
    window.__EKZA_ANIMATOR_TEST__ = testApi.api;
    return () => {
      if (window.__EKZA_ANIMATOR_TEST__ === testApi.api) delete window.__EKZA_ANIMATOR_TEST__;
    };
  }, [testApi]);

  useEffect(() => {
    if (!webgl.ok || canvasFailed) testApi?.settle({ ok: false, renderer: webgl.renderer });
  }, [testApi, webgl, canvasFailed]);

  const onCreated = (state: RootState): void => {
    testApi?.settle({ ok: true, renderer: rendererName(state.gl.getContext()) });
  };

  return (
    <div
      className="ekza-editor relative h-dvh w-dvw overflow-hidden bg-app text-fg [--ekza-tailwind-smoke:editor]"
      data-testid="editor-root"
    >
      {webgl.ok && !canvasFailed ? (
        <CanvasBoundary onError={() => setCanvasFailed(true)}>
          <Canvas
            className="absolute inset-0"
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [2.5, 1.6, 3.5], fov: 40, near: 0.01, far: 200 }}
            onCreated={onCreated}
          >
            <RenderCounter onFrame={testApi === null ? null : () => testApi.countFrame()} />
            <color attach="background" args={['#26272b']} />
            <gridHelper args={[10, 10, '#4b4e58', '#3a3c44']} />
          </Canvas>
        </CanvasBoundary>
      ) : (
        <p className="absolute inset-0 grid place-items-center text-fg-2">
          WebGL 2 is not available in this browser, so the editor cannot start.
        </p>
      )}
      <div className="pointer-events-none absolute left-4 top-3 select-none text-sm text-fg-3">
        Ekza Animator — scaffold (M0)
      </div>
    </div>
  );
}

/** Renders the scene itself (priority 1 takes over R3F's render) so every WebGL frame is counted. */
function RenderCounter(props: { readonly onFrame: (() => void) | null }): null {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
    props.onFrame?.();
  }, 1);
  return null;
}

interface CanvasBoundaryProps {
  readonly onError: () => void;
  readonly children: ReactNode;
}

/** Turns a failed WebGL context creation into a fallback message instead of a crashed page. */
class CanvasBoundary extends Component<CanvasBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Ekza Animator: the WebGL canvas failed to start', error, info.componentStack);
    this.props.onError();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
