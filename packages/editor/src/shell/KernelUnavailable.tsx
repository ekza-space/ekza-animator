// Shown when the editor kernel cannot start (createEditorApp failed, e.g. a build whose editor-core is still a
// stub). The canvas and the degraded test API keep the WebGL smoke checks (E2E-00) meaningful.
import { Canvas, type RootState, useFrame } from '@react-three/fiber';
import { type JSX, useEffect, useState } from 'react';
import { probeWebGl, rendererName } from '../gl/webgl';
import { createPlaceholderTestApi, type PlaceholderTestApi } from '../test-api/placeholder';

function RenderCounter(props: { readonly onFrame: (() => void) | null }): null {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera);
    props.onFrame?.();
  }, 1);
  return null;
}

export function KernelUnavailable(props: { readonly error: unknown; readonly e2e: boolean }): JSX.Element {
  const [testApi] = useState<PlaceholderTestApi | null>(() => (props.e2e ? createPlaceholderTestApi() : null));
  const [webgl] = useState(probeWebGl);
  const message = props.error instanceof Error ? props.error.message : String(props.error);

  useEffect(() => {
    if (testApi === null) return undefined;
    window.__EKZA_ANIMATOR_TEST__ = testApi.api;
    if (!webgl.ok) testApi.settle({ ok: false, renderer: webgl.renderer });
    return () => {
      if (window.__EKZA_ANIMATOR_TEST__ === testApi.api) delete window.__EKZA_ANIMATOR_TEST__;
    };
  }, [testApi, webgl]);

  return (
    <>
      {webgl.ok ? (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          <Canvas
            frameloop="demand"
            dpr={[1, 2]}
            onCreated={(state: RootState) =>
              testApi?.settle({ ok: true, renderer: rendererName(state.gl.getContext()) })
            }
          >
            <RenderCounter onFrame={testApi === null ? null : () => testApi.countFrame()} />
            <color attach="background" args={['#26272b']} />
          </Canvas>
        </div>
      ) : null}
      <div className="relative z-(--z-chrome) grid h-full place-items-center p-8" data-testid="kernel-unavailable">
        <div className="flex max-w-lg flex-col gap-2 rounded-dialog border border-line-strong bg-panel p-5 text-dialog">
          <h1 className="text-dialog-title font-semibold text-fg">The editor could not start</h1>
          <p className="text-fg-2" data-testid="kernel-unavailable-message">
            {message}
          </p>
          <p className="text-ui text-fg-3">
            Reload the page; if this keeps happening, report it with the message above.
          </p>
        </div>
      </div>
    </>
  );
}
