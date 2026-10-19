import { createStore } from 'solid-js/store';
import type { Pattern } from '../library/api';

export type DeckId = 'A' | 'B';

/** Each deck plays on its own superdough orbit, whatever its code says. */
export const ORBIT: Record<DeckId, number> = { A: 1, B: 2 };

/**
 * Strudel code writes tempo as `setcpm(bpm/4)` (four beats per cycle), and the
 * library stores that bpm figure as `cpm` (spec: `setcpm(126/4)` <-> `"cpm": 126`).
 * The header shows the same figure, so convert the scheduler's cycles per second back.
 */
export const BEATS_PER_CYCLE = 4;
export const cpmFromCps = (cps: number): number => Math.round(cps * 60 * BEATS_PER_CYCLE * 100) / 100;

export interface DeckFields {
  id: DeckId;
  name: string;
  code: string;
  playing: boolean;
  error: string | null;
  cpm: number;
  /** Library-relative path of the file this deck saves to; null for a deck never saved. */
  filePath: string | null;
  /** The code as last loaded or saved; dirty tracking compares the live editor text against it. */
  savedCode: string | null;
  /** The pattern as last loaded or saved, so a save keeps its key, tags, notes and source. */
  pattern: Pattern | null;
  /** The file changed on disk while the deck had unsaved edits; shows the Reload / Keep mine bar. */
  diskChanged: boolean;
}

export type DeckState = ReturnType<typeof createDeckState>;

export function createDeckState(id: DeckId) {
  const [state, set] = createStore<DeckFields>({
    id,
    name: 'untitled',
    code: '',
    playing: false,
    error: null,
    cpm: 120,
    filePath: null,
    savedCode: null,
    pattern: null,
    diskChanged: false,
  });
  return {
    state,
    setCode: (code: string) => set('code', code),
    setPlaying: (playing: boolean) => set('playing', playing),
    setError: (error: string | null) => set('error', error),
    setCpm: (cpm: number) => set('cpm', cpm),
    setName: (name: string) => set('name', name),
    /** Points the deck at a file (or none) and records what is on disk; clears any pending disk change. */
    setFile: (filePath: string | null, savedCode: string | null, pattern: Pattern | null = null) =>
      set({ filePath, savedCode, pattern, diskChanged: false }),
    /** The deck's file was renamed or moved: same content, new path. */
    setFilePath: (filePath: string) => set('filePath', filePath),
    setPattern: (pattern: Pattern | null) => set('pattern', pattern),
    setDiskChanged: (diskChanged: boolean) => set('diskChanged', diskChanged),
  };
}
