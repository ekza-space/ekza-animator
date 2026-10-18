// Small text helpers shared by the dialogs (kept apart so each lazily loaded dialog chunk stays independent).

/** A count with its noun in the right number: `1 clip`, `0 clips`, `3 clips`. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}
