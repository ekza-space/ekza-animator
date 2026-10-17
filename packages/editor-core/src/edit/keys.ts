// WP-7a edit kernel stubs (MVP-SPEC §4.11.0, §7 WP-7a): final signatures; bodies throw until the kernel lands.
import { EkzaError, type Frame, type Handle, type TangentType } from '@ekza-animator/anim-core';
import type { ChannelId, ClipId, ControlId, CurveId, KeyId, Tx } from '@ekza-animator/doc';
import type { EditorApp, KeyEditOptions, KeyEditResult } from '../types';

export function moveKeys(
  _app: EditorApp,
  _tx: Tx,
  _keys: readonly KeyId[],
  _dFrames: number,
  _dValue: number,
  _opts: KeyEditOptions,
): KeyEditResult {
  throw new EkzaError('not-implemented', 'editor-core.moveKeys');
}

export function scaleKeys(
  _app: EditorApp,
  _tx: Tx,
  _keys: readonly KeyId[],
  _pivot: Frame,
  _factor: number,
  _opts: KeyEditOptions,
): KeyEditResult {
  throw new EkzaError('not-implemented', 'editor-core.scaleKeys');
}

export function setKeyHandle(
  _app: EditorApp,
  _tx: Tx,
  _key: KeyId,
  _side: 'in' | 'out',
  _handle: Handle,
  _opts: { readonly tempBreak: boolean },
): void {
  throw new EkzaError('not-implemented', 'editor-core.setKeyHandle');
}

export function setTangentTypes(
  _app: EditorApp,
  _tx: Tx,
  _keys: readonly KeyId[],
  _type: TangentType,
  _side: 'both' | 'in' | 'out',
): void {
  throw new EkzaError('not-implemented', 'editor-core.setTangentTypes');
}

export function insertKeyOnCurve(_app: EditorApp, _tx: Tx, _curve: CurveId, _frame: Frame): KeyId {
  throw new EkzaError('not-implemented', 'editor-core.insertKeyOnCurve');
}

export function deleteKeys(_app: EditorApp, _tx: Tx, _keys: readonly KeyId[]): number {
  throw new EkzaError('not-implemented', 'editor-core.deleteKeys');
}

export function ensureCurve(
  _app: EditorApp,
  _tx: Tx,
  _clip: ClipId,
  _control: ControlId,
  _channel: ChannelId,
): CurveId {
  throw new EkzaError('not-implemented', 'editor-core.ensureCurve');
}
