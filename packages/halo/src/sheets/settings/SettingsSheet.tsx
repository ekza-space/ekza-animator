// Placeholder (T6b, being built): the Settings sheet.
import type { JSX } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet } from '../more/kit';

export default function SettingsSheet({ ctx }: HaloSheetProps): JSX.Element {
  return <HaloSheet ctx={ctx} id="settings" title="Settings" />;
}
