import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { initEngine } from '../engine/strudel';
import { installMixer, type DeckMixer, type Knob as KnobName } from '../engine/mixer';
import { Crossfader } from './Crossfader';
import { Deck } from './Deck';
import { createBoothState, DEFAULT_KNOBS } from './boothState';
import { createDeckState, type DeckId } from './deckState';
import { Knob } from './Knob';
import './booth.css';

const DECK_IDS: DeckId[] = ['A', 'B'];
const KNOBS: KnobName[] = ['lpf', 'gain', 'reverb'];

export function Booth() {
  const booth = createBoothState();
  const decks = { A: createDeckState('A'), B: createDeckState('B') };
  let mixer: DeckMixer | undefined;
  // Decks mount only once the mixer is installed, so no orbit is created before it reroutes them.
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    await initEngine();
    mixer = installMixer();
    setReady(true);
  });

  createEffect(() => {
    if (ready()) mixer!.setFader(booth.state.fader);
  });
  for (const id of DECK_IDS) {
    for (const knob of KNOBS) {
      createEffect(() => {
        if (ready()) mixer!.setKnob(id, knob, booth.state.knobs[id][knob]);
      });
    }
  }

  const masterPlay = () => Promise.all(DECK_IDS.map((id) => booth.state.decks[id]?.evaluate(true)));

  const deckKnobs = (id: DeckId) => (
    <div class="booth-knobs" data-deck={id}>
      <For each={KNOBS}>
        {(knob) => (
          <Knob
            label={knob}
            value={booth.state.knobs[id][knob]}
            default={DEFAULT_KNOBS[knob]}
            onChange={(v) => booth.setKnob(id, knob, v)}
          />
        )}
      </For>
    </div>
  );

  return (
    <div class="booth">
      {/* Library sidebar slot, filled in Task 10. */}
      <aside class="booth-library" />
      <main class="booth-main">
        <Show when={ready()} fallback={<div class="booth-loading">loading engine…</div>}>
          <div class="booth-decks">
            <For each={DECK_IDS}>
              {(id) => <Deck state={decks[id]} onReady={(api) => booth.registerDeck(id, api)} />}
            </For>
          </div>
        </Show>
        <footer class="booth-footer">
          {deckKnobs('A')}
          <Crossfader value={booth.state.fader} onChange={booth.setFader} />
          {deckKnobs('B')}
          <button class="deck-btn ghost" disabled title="Sync arrives in a later build">Sync</button>
          <button class="deck-btn" disabled={!ready()} onClick={masterPlay} aria-label="play both decks">▶</button>
        </footer>
      </main>
    </div>
  );
}
