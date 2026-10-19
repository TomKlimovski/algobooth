import type { Pattern } from '../library/api';
import type { DeckFields } from './deckState';

/** CodeMirror keeps LF line endings, so a CRLF file on disk must not count as a difference. */
const normalise = (code: string): string => code.replace(/\r\n/g, '\n');

/** Whether two code texts are the same once line endings are normalised. */
export const sameCode = (a: string, b: string): boolean => normalise(a) === normalise(b);

/**
 * Whether the editor holds unsaved work. `savedCode` null means the deck was never saved: it is dirty
 * only once the editor is non-empty and differs from the deck's default code.
 */
export function isDirty(editorCode: string, savedCode: string | null, defaultCode = ''): boolean {
  if (savedCode === null) return editorCode !== '' && !sameCode(editorCode, defaultCode);
  return !sameCode(editorCode, savedCode);
}

export type DiskChangeDecision = 'ignore' | 'reload' | 'prompt';

/**
 * What a deck does when the watcher reports `changedPaths`: nothing, reload silently, or ask.
 * `""` (the root itself changed) means any file may have changed.
 */
export function onDiskChange(
  state: { filePath: string | null; dirty: boolean },
  changedPaths: string[],
): DiskChangeDecision {
  if (state.filePath === null) return 'ignore';
  if (!changedPaths.includes(state.filePath) && !changedPaths.includes('')) return 'ignore';
  return state.dirty ? 'prompt' : 'reload';
}

export type NewPatternDecision = 'start' | 'save-then-start' | 'abort';

/**
 * New on a deck: a clean deck starts at once; a dirty one asks first, and `confirmed` (OK) saves before
 * starting while Cancel keeps editing. Unsaved edits are never discarded.
 */
export function newPatternDecision(dirty: boolean, confirmed: boolean): NewPatternDecision {
  if (!dirty) return 'start';
  return confirmed ? 'save-then-start' : 'abort';
}

/** The pattern file for a deck; `existing` (the loaded pattern) keeps its key, tags, notes and source. */
export function patternFromDeck(deck: Pick<DeckFields, 'name' | 'code' | 'cpm'>, existing?: Pattern): Pattern {
  return {
    name: deck.name,
    code: deck.code,
    cpm: deck.cpm,
    key: existing?.key ?? '',
    tags: existing?.tags ?? [],
    source: existing?.source ?? { kind: 'mine' },
    notes: existing?.notes ?? '',
  };
}
