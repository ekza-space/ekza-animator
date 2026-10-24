// STUDIO-TOUCH-SPEC §15 (T6b): the capability inventory is committed, and its FEATURES.md column names the rows of
// docs/FEATURES.md that describe each capability. An id is `F<section>:<Feature name>`: the number of the row's
// `## N.` heading and its first cell without `*` emphasis or backticks; where one name occurs twice in a section, both
// rows take their `### N.M` number instead. A cell is `—` or the ids as code spans separated by `, ` (feature names
// contain commas, so the code spans delimit the ids).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const INVENTORY_HEADER = ['#', 'Capability', 'FEATURES.md', 'Ekza Studio surface', 'Depth', 'Pro gap closed / notes'];
const INVENTORY_ROWS = 191;
const SUBSECTIONS = 14;

interface Table {
  readonly h2: string;
  readonly h3: string;
  readonly header: readonly string[];
  readonly rows: string[][];
}

/** The cells of a table row: split on `|` outside code spans; `\|` is a literal pipe. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let code = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|' && !code) {
      out.push(cell.trim());
      cell = '';
    } else {
      if (ch === '`') code = !code;
      cell += ch;
    }
  }
  out.push(cell.trim());
  return out.slice(1, -1);
}

/** Every table outside code fences, with the `##` and `###` headings above it. */
function tables(markdown: string): Table[] {
  const out: Table[] = [];
  let h2 = '';
  let h3 = '';
  let fence = false;
  let current: Table | null = null;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    if (!fence && line.startsWith('|')) {
      const row = cells(line);
      if (current === null) {
        current = { h2, h3, header: row, rows: [] };
        out.push(current);
      } else if (!row.every((cell) => /^:?-+:?$/.test(cell))) current.rows.push(row);
      continue;
    }
    current = null;
    if (fence) continue;
    if (line.startsWith('## ')) {
      h2 = line.slice(3);
      h3 = '';
    } else if (line.startsWith('### ')) h3 = line.slice(4);
  }
  return out;
}

/** FEATURES.md row id → the number of rows it names (more than one: ambiguous, never a valid reference). */
function featureIds(markdown: string): Map<string, number> {
  const rows = tables(markdown).flatMap((table) => {
    const section = /^(\d+)\. /.exec(table.h2)?.[1];
    if (section === undefined) return [];
    const subsection = /^(\d+\.\d+) /.exec(table.h3)?.[1] ?? null;
    return table.rows.map((row) => ({
      section,
      subsection,
      name: (row[0] ?? '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim(),
    }));
  });
  const perSection = new Map<string, number>();
  for (const { section, name } of rows)
    perSection.set(`${section}:${name}`, (perSection.get(`${section}:${name}`) ?? 0) + 1);
  const ids = new Map<string, number>();
  for (const { section, subsection, name } of rows) {
    const repeated = (perSection.get(`${section}:${name}`) ?? 0) > 1;
    const id = `F${repeated && subsection !== null ? subsection : section}:${name}`;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  return ids;
}

interface Subsection {
  readonly number: number;
  readonly declared: number;
  readonly table: Table;
}

const features = featureIds(read('../../../docs/FEATURES.md'));
const subsections: Subsection[] = tables(read('../../../docs/STUDIO-TOUCH-SPEC.md')).flatMap((table) => {
  const match = /^15\.(\d+) .*\((\d+)\)$/.exec(table.h3);
  if (!table.h2.startsWith('15. ') || match === null) return [];
  const number = Number(match[1]);
  return number >= 1 && number <= SUBSECTIONS ? [{ number, declared: Number(match[2]), table }] : [];
});
const column = INVENTORY_HEADER.indexOf('FEATURES.md');
const rows = subsections.flatMap(({ table }) =>
  table.rows.map((row) => {
    const cell = row[column] ?? '';
    const wellFormed = cell === '—' || /^`[^`]+`(, `[^`]+`)*$/.test(cell);
    const ids = cell === '—' ? [] : [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
    return { id: row[0] ?? '', cells: row.length, cell, wellFormed, ids };
  }),
);
const mapped = rows.filter((row) => row.ids.length > 0).length;

describe('STUDIO-TOUCH-SPEC §15 capability inventory ↔ FEATURES.md (T6b)', () => {
  it('has the tables §15.1–§15.14, each with the FEATURES.md column', () => {
    expect(subsections.map((subsection) => subsection.number)).toEqual(
      Array.from({ length: SUBSECTIONS }, (_, i) => i + 1),
    );
    for (const { table } of subsections) expect(table.header, table.h3).toEqual(INVENTORY_HEADER);
    expect(rows.filter((row) => row.cells !== INVENTORY_HEADER.length).map((row) => row.id)).toEqual([]);
  });

  it(`numbers its ${INVENTORY_ROWS} rows k.1… in each §15.k, as many as the heading says`, () => {
    for (const { number, declared, table } of subsections) {
      expect(
        table.rows.map((row) => row[0]),
        table.h3,
      ).toEqual(Array.from({ length: declared }, (_, i) => `${number}.${i + 1}`));
    }
    expect(rows).toHaveLength(INVENTORY_ROWS);
    expect(new Set(rows.map((row) => row.id)).size).toBe(INVENTORY_ROWS);
  });

  it('names FEATURES.md rows by ids that each resolve to exactly one row', () => {
    const malformed = rows.filter((row) => !row.wellFormed || row.ids.some((id) => !/^F\d+(\.\d+)?:\S/.test(id)));
    expect(malformed.map((row) => `${row.id}: ${row.cell}`)).toEqual([]);
    const repeated = rows.filter((row) => new Set(row.ids).size !== row.ids.length);
    expect(repeated.map((row) => row.id)).toEqual([]);
    const unresolved = rows.flatMap((row) =>
      row.ids.filter((id) => features.get(id) !== 1).map((id) => `${row.id}: ${id} (${features.get(id) ?? 0} rows)`),
    );
    expect(unresolved).toEqual([]);
  });

  it(`maps ${mapped} of ${rows.length} rows to FEATURES.md; the other ${rows.length - mapped} are new here or not shipped`, () => {
    expect(mapped).toBeGreaterThan(0);
    expect(rows.filter((row) => row.ids.length === 0).every((row) => row.cell === '—')).toBe(true);
  });
});
