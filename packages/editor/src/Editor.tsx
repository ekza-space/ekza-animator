// The editor root (MVP-SPEC §7 WP-8): creates the browser services and the EditorApp, registers the built-in panels
// and mounts the shell (dockview workspace, menus, status line, dialogs) over one R3F canvas.
import { createEditorApp } from '@ekza-studio/editor-core';
import type { JSX } from 'react';
import { type CreateAppArgs, EditorRoot } from './shell/EditorRoot';

export interface EditorProps {
  /** Default '/decoders/'. */
  readonly decoderPath?: string;
  /** Default '/samples/'. */
  readonly samplesPath?: string;
  /** M6b (§0.4.7): the clip library's base URL; default '/library/'. */
  readonly libraryPath?: string;
  /** M1-stretch. */
  readonly createValidatorWorker?: () => Worker;
  /** The build allows e2e mode (`NEXT_PUBLIC_EKZA_E2E=1`); the test API installs only with `?e2e=1` as well. */
  readonly e2e?: boolean;
  /** M6a (M6A-SPEC §3 rule 8): development builds validate every mesh commit. */
  readonly kernelDebug?: boolean;
}

const createProductionApp = (args: CreateAppArgs) =>
  createEditorApp({
    services: args.services,
    platform: args.platform,
    ...(args.idSource === undefined ? {} : { idSource: args.idSource }),
  });

export function Editor(props: EditorProps): JSX.Element {
  return (
    <EditorRoot
      createApp={createProductionApp}
      {...(props.decoderPath === undefined ? {} : { decoderPath: props.decoderPath })}
      {...(props.samplesPath === undefined ? {} : { samplesPath: props.samplesPath })}
      {...(props.libraryPath === undefined ? {} : { libraryPath: props.libraryPath })}
      {...(props.e2e === undefined ? {} : { e2e: props.e2e })}
      {...(props.kernelDebug === undefined ? {} : { kernelDebug: props.kernelDebug })}
      {...(props.createValidatorWorker === undefined ? {} : { createValidatorWorker: props.createValidatorWorker })}
    />
  );
}
