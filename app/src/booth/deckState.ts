import { createStore } from 'solid-js/store';

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
  });
  return {
    state,
    setCode: (code: string) => set('code', code),
    setPlaying: (playing: boolean) => set('playing', playing),
    setError: (error: string | null) => set('error', error),
    setCpm: (cpm: number) => set('cpm', cpm),
    setName: (name: string) => set('name', name),
  };
}
