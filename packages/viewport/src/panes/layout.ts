// Pane layouts of the viewport panel (MVP-SPEC §1.1, research 09 §3) and the GL viewport of a pane inside the one
// shared canvas (ADR 0006 §1).
import type { CameraId } from '@ekza-animator/doc';
import type { ViewportLayout } from '@ekza-animator/editor-core';
import type { PaneCamera, ViewPreset } from '../types';

/**
 * Pane ids per layout, in reading order. `split` is the owner's shot | free layout; `quad` is Maya's four view
 * (top | persp / front | side). Pane ids are stable, so cameras and display flags survive layout switches.
 */
export const LAYOUT_PANES: Readonly<Record<ViewportLayout, readonly string[]>> = {
  single: ['pane-single'],
  split: ['pane-left', 'pane-right'],
  quad: ['pane-top', 'pane-persp', 'pane-front', 'pane-side'],
};

/**
 * Shot binding that resolves to the document's first shot camera. A shot binding whose camera does not exist (this
 * one, or a deleted camera) falls back to the first shot camera by order, and to the pane's own perspective view
 * camera when the document has none.
 */
export const FIRST_SHOT_CAMERA: PaneCamera = { kind: 'shot', cameraId: '' as CameraId };

const VIEW = (preset: ViewPreset): PaneCamera => ({ kind: 'view', preset });

const DEFAULT_CAMERAS: Readonly<Record<string, PaneCamera>> = {
  'pane-single': VIEW('persp'),
  'pane-left': FIRST_SHOT_CAMERA,
  'pane-right': VIEW('persp'),
  'pane-top': VIEW('top'),
  'pane-persp': VIEW('persp'),
  'pane-front': VIEW('front'),
  'pane-side': VIEW('side'),
};

/** The camera a pane looks through until the user picks another one. Unknown pane ids get `persp`. */
export function defaultPaneCamera(paneId: string): PaneCamera {
  return DEFAULT_CAMERAS[paneId] ?? VIEW('persp');
}

/** A rectangle in CSS px. */
export interface CssRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** GL viewport/scissor rectangle in CSS px with a bottom-left origin (WebGLRenderer multiplies by the DPR). */
export interface GlRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where a pane draws: the full pane (projection) and the part inside the canvas (scissor). */
export interface PaneGl {
  readonly viewport: GlRect;
  readonly scissor: GlRect;
}

/**
 * The GL rectangles of a pane inside the canvas; null when nothing of the pane is visible. Both inputs come from
 * `getBoundingClientRect()` (page CSS px). The viewport keeps the pane's full size so a pane that sticks out of the
 * canvas keeps its projection; the scissor is clipped to the canvas.
 */
export function paneGl(canvas: CssRect, pane: CssRect): PaneGl | null {
  if (pane.width < 1 || pane.height < 1) return null;
  const left = Math.max(pane.left, canvas.left);
  const top = Math.max(pane.top, canvas.top);
  const right = Math.min(pane.left + pane.width, canvas.left + canvas.width);
  const bottom = Math.min(pane.top + pane.height, canvas.top + canvas.height);
  if (right - left < 1 || bottom - top < 1) return null;
  const canvasBottom = canvas.top + canvas.height;
  return {
    viewport: {
      x: pane.left - canvas.left,
      y: canvasBottom - (pane.top + pane.height),
      width: pane.width,
      height: pane.height,
    },
    scissor: { x: left - canvas.left, y: canvasBottom - bottom, width: right - left, height: bottom - top },
  };
}

/** Plain copy of a DOMRect-like value. */
export function cssRectOf(rect: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): CssRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
