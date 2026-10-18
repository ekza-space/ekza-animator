// A self-contained 3D host for the viewport panel when no shell GL host exists: an app without a model loader
// (`services.models === null`: the shared test kit's fake app in /dev/panels and browser tests) gets its own canvas,
// WebGLRenderer, ViewportManager and render-on-demand loop behind the panel. In the editor the shell's R3F canvas
// creates the ViewportManager instead (WP-8 GLHost), and this host never mounts.
import type { EditorApp } from '@ekza-animator/editor-core';
import { registerViewportContributions, ViewportManager } from '@ekza-animator/viewport';
import { type JSX, useEffect, useRef, useState } from 'react';
import { WebGLRenderer } from 'three';

/** True when the panel should host its own canvas (see the module comment). */
export function needsStandaloneHost(app: EditorApp): boolean {
  return app.services.models === null;
}

export function StandaloneHost(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webgl] = useState(canCreateWebGl2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !webgl) return undefined;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true });
    } catch (error) {
      console.error('Ekza Animator: the viewport canvas failed to start', error);
      return undefined;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(rect.width, 1), Math.max(rect.height, 1), false);
    };
    resize();
    const vm = new ViewportManager({ app, renderer });
    const contributions = registerViewportContributions(app, vm);
    let frame = 0;
    const draw = (): void => {
      frame = 0;
      // The frame loop's first step (M2A-SPEC §4.5): coalesced gesture updates scheduled before this frame.
      app.flushScheduled();
      app.evaluation.tick();
      vm.render();
    };
    app.setFrameRequester(() => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    });
    const observer = new ResizeObserver(() => {
      resize();
      app.requestFrame();
    });
    observer.observe(canvas);
    app.requestFrame();
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      app.setFrameRequester(() => {});
      contributions();
      vm.dispose();
      renderer.dispose();
    };
  }, [app, webgl]);

  return !webgl ? (
    <p className="absolute inset-0 grid place-items-center text-[12px] text-fg-3">WebGL is not available.</p>
  ) : (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      data-testid="viewport-standalone-canvas"
    />
  );
}

/** Whether a WebGL 2 context can be created (throwaway probe; the context is released at once). */
function canCreateWebGl2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}
