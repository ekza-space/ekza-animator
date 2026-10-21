// Session (U state) defaults, MVP-SPEC §4.5, M2A-SPEC §4.5 and M6A-SPEC §4.6: every value here is the documented
// default.
import type { UserId } from '@ekza-studio/doc';
import type { AutosaveStatus, ModelSessionState, SessionState, TimeState, ToolState } from '../types';

export const DEFAULT_TIME: TimeState = {
  sceneFrame: 0,
  playing: false,
  direction: 1,
  loop: 'loop',
  speed: 'realtime',
  playbackRange: null,
  snapToFrames: true,
  band: null,
};

export const DEFAULT_TOOLS: ToolState = {
  viewport: 'select',
  graph: 'select',
  dopeSheet: 'select',
  manipulatorSize: 90,
  selectionMask: { controls: true, joints: false, meshes: false, groups: false },
  keyTarget: 'selected',
  ripple: false,
  tweenTarget: 'auto',
};

/** Autosave before the host opened a slot (or without an autosave store): off, nothing pending (M2a). */
export const DEFAULT_AUTOSAVE: AutosaveStatus = {
  enabled: false,
  slot: null,
  lastSavedAt: null,
  pending: false,
  error: null,
};

const ZERO_COUNTS = { vertex: 0, edge: 0, face: 0 } as const;

/** `session.model` defaults (M6A-SPEC §4.6). */
export function defaultModelSession(): ModelSessionState {
  return {
    componentMode: 'object',
    lastComponentMode: 'vertex',
    hilite: [],
    components: { version: 0, selected: ZERO_COUNTS, mirrored: ZERO_COUNTS, hidden: ZERO_COUNTS },
    symmetry: new Map(),
    softSelect: { on: false, radius: 0.5, falloff: 'volume', curve: 'smooth' },
    constraint: 'off',
    selectionStyle: 'marquee',
    cameraBased: 'auto',
    backfaces: false,
    snap: { grid: false, vertex: false, increment: false },
    pivotEdit: false,
    componentPivot: null,
    hiddenObjects: new Set(),
    isolate: {},
    extrudeSession: null,
    capture: { armed: null, field: null, text: null },
    lastTool: null,
    activeSwatch: null,
    tweakHandle: null,
  };
}

export function defaultSession(user: UserId = 'local' as UserId): SessionState {
  return {
    user,
    projectName: 'Untitled',
    dirty: false,
    activeCharacter: null,
    activeClip: {},
    selection: { controls: [], keys: new Map(), channels: [], objects: [] },
    time: DEFAULT_TIME,
    tools: DEFAULT_TOOLS,
    overrides: new Map(),
    hiddenControls: new Set(),
    showSecondary: false,
    viewportLayout: 'split',
    maximizedPane: null,
    hoveredPanel: null,
    hoverControl: null,
    clipboard: { pose: null, keys: null },
    feetPins: null,
    dialog: null,
    busy: null,
    curveBuffers: new Map(),
    autosave: DEFAULT_AUTOSAVE,
    recovery: [],
    // M6a (M6A-SPEC §4.6)
    workspace: 'animate',
    lastRun: null,
    model: defaultModelSession(),
    workspaceViews: {},
  };
}
