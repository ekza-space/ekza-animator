// STUDIO-TOUCH-SPEC §20.1, §20.4 (T2): the package's frozen contract — the shell marker the size gate looks for, the
// session mirror key, the stages in Path order and the workspace ↔ stage mapping of a switch (§16.1).
import type { WorkspaceId } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import {
  HALO_SESSION_KEY,
  HALO_SHELL_MARKER,
  HALO_STAGES,
  HaloShell,
  stageOfWorkspace,
  workspaceOfStage,
} from '../src';

describe('@ekza-studio/halo contract (T2)', () => {
  it('names the marker, the session key and the stages', () => {
    expect(HALO_SHELL_MARKER).toBe('ekza-halo-shell');
    expect(HALO_SESSION_KEY).toBe('ekza-studio:halo:session:v1');
    expect(HALO_STAGES).toEqual(['make', 'paint', 'rig', 'animate']);
    expect(typeof HaloShell).toBe('function');
  });

  it.each([
    ['model', 'make'],
    ['rig', 'rig'],
    ['animate', 'animate'],
    ['review', 'make'],
  ] as [WorkspaceId, string][])('a switch from Pro in %s arrives at %s', (workspace, stage) => {
    expect(stageOfWorkspace(workspace)).toBe(stage);
  });

  it('every stage runs in a workspace that maps back to it (Paint runs in Model)', () => {
    expect(HALO_STAGES.map((stage) => [stage, workspaceOfStage(stage)])).toEqual([
      ['make', 'model'],
      ['paint', 'model'],
      ['rig', 'rig'],
      ['animate', 'animate'],
    ]);
    for (const stage of HALO_STAGES) {
      expect(stageOfWorkspace(workspaceOfStage(stage))).toBe(stage === 'paint' ? 'make' : stage);
    }
  });
});
