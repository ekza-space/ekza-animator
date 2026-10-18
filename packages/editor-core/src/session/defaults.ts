// Session (U state) defaults, MVP-SPEC §4.5: every value here is the documented default.
import type { UserId } from '@ekza-animator/doc';
import type { SessionState, TimeState, ToolState } from '../types';

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
  manipulatorSize: 90,
  selectionMask: { controls: true, joints: false, meshes: false },
  keyTarget: 'selected',
};

export function defaultSession(user: UserId = 'local' as UserId): SessionState {
  return {
    user,
    projectName: 'Untitled',
    dirty: false,
    activeCharacter: null,
    activeClip: {},
    selection: { controls: [], keys: new Map(), channels: [] },
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
  };
}
