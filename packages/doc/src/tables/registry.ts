// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until the table registry lands.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { Partition, RecordOf, TableDef, TableName } from '../records';

export function registerTable(_def: TableDef): Disposer {
  throw new EkzaError('not-implemented', 'doc.registerTable');
}

export function getTableDef(_name: string): TableDef | undefined {
  throw new EkzaError('not-implemented', 'doc.getTableDef');
}

export function partitionOf<T extends TableName>(_table: T, _record: RecordOf<T>): Partition {
  throw new EkzaError('not-implemented', 'doc.partitionOf');
}

/** [] = valid. */
export function validateRecord<T extends TableName>(_table: T, _record: unknown): readonly string[] {
  throw new EkzaError('not-implemented', 'doc.validateRecord');
}
