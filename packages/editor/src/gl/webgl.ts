export interface WebGlInfo {
  readonly ok: boolean;
  readonly renderer: string | null;
}

/** Creates a throwaway WebGL2 context to learn whether the canvas can render and with which GPU. */
export function probeWebGl(): WebGlInfo {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl === null) return { ok: false, renderer: null };
    const info = rendererName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer: info };
  } catch {
    return { ok: false, renderer: null };
  }
}

export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const name: unknown = gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL);
  return typeof name === 'string' ? name : null;
}
