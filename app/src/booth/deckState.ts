import { createStore, unwrap } from 'solid-js/store';
import type { Pattern } from '../library/api';
import type { Layout } from './keys/bindings';

/** A fresh empty layer each time: the store wraps what it holds in place, and EMPTY_LAYOUT is frozen. */
const emptyLayout = (): Layout => ({ bindings: {} });
/** A plain deep copy, so the working layer, the saved layer and the file's own `keys` never share an object. */
const copyLayout = (l: Layout): Layout => JSON.parse(JSON.stringify(unwrap(l)));

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
  /** The tempo the header shows: the deck's effective tempo, which is deck A's while sync is on. */
  cpm: number;
  /** The tempo the deck's own code set at its last evaluation, before sync; what Save writes. */
  codeCpm: number;
  /** Library-relative path of the file this deck saves to; null for a deck never saved. */
  filePath: string | null;
  /** The code as last loaded or saved; dirty tracking compares the live editor text against it. */
  savedCode: string | null;
  /** The pattern as last loaded or saved, so a save keeps its key, tags, notes and source. */
  pattern: Pattern | null;
  /** The file changed on disk while the deck had unsaved edits; shows the Reload / Keep mine bar. */
  diskChanged: boolean;
  /**
   * The live editor text, on every keystroke (`code` only follows evaluations). The key strip's lights
   * are a derivation over it, so a hand edit relights them without an evaluation.
   */
  liveCode: string;
  /** The pattern's own key layer, in memory: edits make the deck dirty, Save writes them. */
  keys: Layout;
  /** `keys` as last loaded or saved; null for a deck never pointed at a file. */
  savedKeys: Layout | null;
  /** The pattern line (its 1-based `n`) the keys act on; null when there is none yet. */
  targetLine: number | null;
  /** Key edits waiting for the next boundary, and the beats until it (null when nothing waits). */
  queued: number;
  beatsLeft: number | null;
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
    codeCpm: 120,
    filePath: null,
    savedCode: null,
    pattern: null,
    diskChanged: false,
    liveCode: '',
    keys: emptyLayout(),
    savedKeys: null,
    targetLine: null,
    queued: 0,
    beatsLeft: null,
  });
  return {
    state,
    setCode: (code: string) => set('code', code),
    setPlaying: (playing: boolean) => set('playing', playing),
    setError: (error: string | null) => set('error', error),
    setCpm: (cpm: number) => set('cpm', cpm),
    setCodeCpm: (codeCpm: number) => set('codeCpm', codeCpm),
    setName: (name: string) => set('name', name),
    /**
     * Points the deck at a file (or none) and records what is on disk; clears any pending disk change.
     * The file's key layer comes with it, as both the working and the saved layer.
     */
    setFile: (filePath: string | null, savedCode: string | null, pattern: Pattern | null = null) => {
      const keys = pattern?.keys ? copyLayout(pattern.keys) : emptyLayout();
      set({ filePath, savedCode, pattern, diskChanged: false, keys, savedKeys: copyLayout(keys) });
    },
    /** The deck's file was renamed or moved: same content, new path. */
    setFilePath: (filePath: string) => set('filePath', filePath),
    setPattern: (pattern: Pattern | null) => set('pattern', pattern),
    setDiskChanged: (diskChanged: boolean) => set('diskChanged', diskChanged),
    setLiveCode: (liveCode: string) => set('liveCode', liveCode),
    // Root-level, so the layer is replaced: the path form `set('keys', l)` would merge into the old object.
    setKeys: (keys: Layout) => set({ keys }),
    setTargetLine: (targetLine: number | null) => set('targetLine', targetLine),
    setQueue: (queued: number, beatsLeft: number | null) => set({ queued, beatsLeft }),
  };
}
