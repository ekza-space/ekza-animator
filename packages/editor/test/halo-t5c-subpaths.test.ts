// T5c (STUDIO-TOUCH-SPEC §20.1, §20.3 item 9, §20.6; ST-B1): the measured subpaths Halo imports from the editor —
// `./models`, `./overlays`, `./toolkit`, `./agent`. Their export lists are pinned: every module behind them costs
// `/editor` bytes once Halo imports it if `/editor` loads it eagerly (AR-D3-1), so an addition is measured first
// (docs/wp-notes/halo-t5c.md) and then listed here. The modules left out on purpose stay out.
import { describe, expect, it } from 'vitest';
import * as agent from '../src/agent';
import * as models from '../src/models';
import * as overlays from '../src/overlays';
import * as toolkit from '../src/toolkit';

const names = (module: object): string[] => Object.keys(module).sort();

describe('T5c editor subpaths', () => {
  it('./models: the Model Outliner tree, the Channels readout, clip settings and the colour palette', () => {
    expect(names(models)).toEqual(
      [
        // outliner/modelTree, outliner/sceneSelection
        'REFERENCE_KEY',
        'SCENE_KEY',
        'assetKey',
        'buildModelOutlinerRows',
        'characterKey',
        'containerMeshes',
        'dropTargetOf',
        'meshesKey',
        'nextObjectSelection',
        'objectKey',
        'ownerKeyOf',
        'planeKey',
        'readModelOutlinerDoc',
        'rowId',
        'selectObjects',
        // channels/readout
        'ChannelReadout',
        'PROXY_CELL',
        'channelText',
        // clips/settings
        'CLIP_NAME_MAX',
        'EMPTY_SOURCE',
        'FPS_PRESETS',
        'LICENSE_PRESETS',
        'MAX_FPS',
        'MAX_TAGS',
        'REDISTRIBUTABLE_LABEL',
        'ROOT_MOTION_HINT',
        'ROOT_MOTION_LABEL',
        'SLOT_VOCABULARY',
        'checkDraft',
        'draftFromClip',
        'formatDuration',
        'formatFps',
        'fpsFromNumber',
        'fpsToNumber',
        'parseTags',
        'redistributionHint',
        'sameFps',
        'sourceDraft',
        'validateClipName',
        // palette/model
        'MAX_RECENTS',
        'SWATCHES_PER_ROW',
        'byOrder',
        'contrastOn',
        'leadMeshId',
        'palettesOf',
        'pushRecent',
        'shownPalette',
        'swatchesOf',
        'targetMeshIds',
        'usageLine',
        'usedSlots',
      ].sort(),
    );
  });

  it('./models leaves out the modules that cost /editor bytes without a first-stage consumer', () => {
    // outliner/model (the rig tree, +241 B), graph/model (+550 B), channels/states (+80 B), channels/nudge (+178 B),
    // channels/kit/kernel (editor-core and doc aliases; its readVrmLicense is io's)
    const leftOut = [
      'buildOutlinerRows',
      'readOutlinerDoc',
      'controlHierarchy',
      'visibleCurves',
      'toolbarState',
      'CHANNEL_STATE_STYLE',
      'channelStateTitle',
      'ChannelNudge',
      'nudgeStep',
      'formatChannelValue',
      'readVrmLicense',
      'startChannelEditGesture',
    ];
    expect(leftOut.filter((name) => name in models)).toEqual([]);
  });

  it('./overlays: the marking-menu geometry and the command palette controller', () => {
    expect(names(overlays)).toEqual(
      [
        'COMPASS',
        'EDGE_MARGIN',
        'FLICK_MS',
        'FLICK_PX',
        'LIST_OFFSET',
        'MM_RADIUS',
        'createCommandPaletteController',
        'filterEntries',
        'formatParam',
        'fuzzyScore',
        'menuLabel',
        'paletteEntries',
        'parseParam',
        'slotPosition',
        'slotToward',
      ].sort(),
    );
    // the geometry Halo's ring draws with: eight slots at 80 px, the flick's dead zone
    expect(overlays.COMPASS).toHaveLength(8);
    expect(overlays.slotToward(0, -40)).toBe('N');
    expect(overlays.slotToward(5, 5)).toBeNull();
    expect(overlays.slotPosition(100, 100, 'E')).toEqual({ x: 100 + overlays.MM_RADIUS, y: 100 });
  });

  it('./toolkit: the label slider, param sections and option defaults', () => {
    expect(names(toolkit)).toEqual(['LABEL_DRAG_PX', 'paramSections', 'setOptionDefault', 'startParamSlide']);
    const sections = toolkit.paramSections([
      { name: 'a', type: 'float', label: 'A', default: 0 },
      { name: 'b', type: 'float', label: 'B', default: 0, group: 'More' },
      { name: 'c', type: 'float', label: 'C', default: 0 },
    ] as never);
    expect(sections.map((section) => [section.group, section.params.map((param) => param.name)])).toEqual([
      [null, ['a', 'c']],
      ['More', ['b']],
    ]);
  });

  it('./agent: the Agent panel body, and the runtime the Ask sheet and History read (T10, ST-T10-13)', () => {
    expect(names(agent)).toEqual(['AGENT_SHOW', 'AgentPanel', 'agentRuntimeOf', 'existingAgentRuntime', 'pillView']);
    expect(typeof agent.AgentPanel).toBe('function');
    expect(agent.AGENT_SHOW).toBe('agent.show');
  });
});
