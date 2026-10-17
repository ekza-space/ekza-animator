// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until record helpers land.
import { type AnimCurve, EkzaError } from '@ekza-animator/anim-core';
import type { CameraRecord, ClipRecord, CurveRecord, KeyRecord, LayerRecord, ProjectRecord } from '../records';

export function makeProject(_fields?: Partial<ProjectRecord>): ProjectRecord {
  throw new EkzaError('not-implemented', 'doc.makeProject');
}

export function makeLayer(_fields: Pick<LayerRecord, 'clip'> & Partial<LayerRecord>): LayerRecord {
  throw new EkzaError('not-implemented', 'doc.makeLayer');
}

export function makeClip(_fields: Pick<ClipRecord, 'character' | 'name' | 'fps'> & Partial<ClipRecord>): ClipRecord {
  throw new EkzaError('not-implemented', 'doc.makeClip');
}

export function makeCurve(
  _fields: Pick<CurveRecord, 'clip' | 'layer' | 'control' | 'channel'> & Partial<CurveRecord>,
): CurveRecord {
  throw new EkzaError('not-implemented', 'doc.makeCurve');
}

export function makeKey(_fields: Pick<KeyRecord, 'clip' | 'curve' | 't' | 'v'> & Partial<KeyRecord>): KeyRecord {
  throw new EkzaError('not-implemented', 'doc.makeKey');
}

export function makeCamera(_fields: Pick<CameraRecord, 'name' | 'transform'> & Partial<CameraRecord>): CameraRecord {
  throw new EkzaError('not-implemented', 'doc.makeCamera');
}

export function toAnimCurve(_curve: CurveRecord, _keys: readonly KeyRecord[]): AnimCurve {
  throw new EkzaError('not-implemented', 'doc.toAnimCurve');
}
