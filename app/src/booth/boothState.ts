import { createStore } from 'solid-js/store';
import type { Knob } from '../engine/mixer';
import { DEFAULT_MASTER_CONTROLS, type MasterControl } from '../engine/controlMap';
import type { DeckApi } from './Deck';
import type { DeckId } from './deckState';

export type KnobValues = Record<Knob, number>;

/** Booth state: fader and knob positions belong to the booth, not to the pattern a deck plays. */
export interface BoothFields {
  /** Crossfader position: 0 is full deck A, 1 is full deck B. */
  fader: number;
  knobs: Record<DeckId, KnobValues>;
  /** Master section over the summed mix, after both deck chains. */
  master: Record<MasterControl, number>;
  decks: Record<DeckId, DeckApi | null>;
  /** Sync latched: deck B follows deck A's tempo and bar line. */
  sync: boolean;
  /** Transient footer notice, such as why Sync refused. */
  message: string | null;
}

/** Filter open, unity gain (0.83 of the mixer's [0, 1.2] gain range), dry. */
export const DEFAULT_KNOBS: KnobValues = { lpf: 1, gain: 0.83, reverb: 0 };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export type BoothState = ReturnType<typeof createBoothState>;

export function createBoothState() {
  const [state, set] = createStore<BoothFields>({
    fader: 0.5,
    knobs: { A: { ...DEFAULT_KNOBS }, B: { ...DEFAULT_KNOBS } },
    master: { ...DEFAULT_MASTER_CONTROLS },
    decks: { A: null, B: null },
    sync: false,
    message: null,
  });
  return {
    state,
    setFader: (x: number) => set('fader', clamp01(x)),
    setKnob: (deck: DeckId, knob: Knob, v: number) => set('knobs', deck, knob, clamp01(v)),
    setMaster: (control: MasterControl, v: number) => set('master', control, clamp01(v)),
    registerDeck: (id: DeckId, api: DeckApi) => set('decks', id, api),
    setSync: (on: boolean) => set('sync', on),
    setMessage: (message: string | null) => set('message', message),
  };
}
