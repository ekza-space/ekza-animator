// Shell harness behind the dev/e2e-only route /dev/shell (MVP-SPEC §7 WP-8): the complete editor shell — dockview
// workspace, menus, status line, dialogs, input adapter, GL host, test API — over a fake EditorApp loaded with the
// synthetic wave document, so the shell can be exercised before the real kernel (WP-7a/7b) is merged. Browser only.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '@ekza-animator/doc';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { type JSX, useCallback } from 'react';
import { EditorRoot } from '../shell/EditorRoot';
import type { Shell } from '../shell/types';
import type { Summarizer } from '../shell/summary';
import { type EditorParams, parseEditorParams } from '../test-api/params';

declare global {
  interface Window {
    /** Set while /dev/shell is mounted: specs register stand-in operators and inspect the fake app. */
    __EKZA_DEV_SHELL__?: { readonly app: FakeEditorApp; readonly shell: Shell };
  }
}

export interface ShellHarnessProps {
  /** A DocSnapshot, e.g. fixtures/synthetic/wave-doc.json (checked at runtime); null starts empty. */
  readonly snapshot: unknown;
  /** A SkeletonDesc for every character's runtime; null: no runtimes. */
  readonly skeleton: unknown;
  /** Default: the page URL's parameters, e2e allowed (the route exists only in dev and e2e builds). */
  readonly params?: EditorParams;
  readonly summarize?: Summarizer;
}

export function ShellHarness(props: ShellHarnessProps): JSX.Element {
  const snapshot = props.snapshot === null ? undefined : asSnapshot(props.snapshot);
  const skeleton = props.skeleton === null ? undefined : asSkeleton(props.skeleton);
  const expose = useCallback((shell: Shell) => {
    const exposed = { app: shell.app as FakeEditorApp, shell };
    window.__EKZA_DEV_SHELL__ = exposed;
    return () => {
      if (window.__EKZA_DEV_SHELL__ === exposed) delete window.__EKZA_DEV_SHELL__;
    };
  }, []);
  return (
    <EditorRoot
      e2e
      onShell={expose}
      params={props.params ?? parseEditorParams(window.location.search, true)}
      {...(props.summarize === undefined ? {} : { summarize: props.summarize })}
      createApp={({ services, platform }) =>
        createFakeEditorApp({
          ...(snapshot === undefined ? {} : { snapshot }),
          ...(skeleton === undefined ? {} : { skeleton }),
          services,
          platform,
        })
      }
    />
  );
}

function asSnapshot(value: unknown): DocSnapshot {
  const candidate = value as Partial<DocSnapshot> | null;
  if (candidate?.format !== 'ekza-animator-doc' || typeof candidate.tables !== 'object') {
    throw new EkzaError('invalid-record', 'ShellHarness: `snapshot` is not an ekza-animator-doc snapshot');
  }
  return value as DocSnapshot;
}

function asSkeleton(value: unknown): SkeletonDesc {
  const candidate = value as Partial<SkeletonDesc> | null;
  if (!Array.isArray(candidate?.nodes) || !Array.isArray(candidate.facing)) {
    throw new EkzaError('invalid-record', 'ShellHarness: `skeleton` is not a SkeletonDesc');
  }
  return value as SkeletonDesc;
}
