import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { initEngine } from '../engine/strudel';
import { LibraryTree } from '../library/LibraryTree';
import type { LibraryStore } from '../library/store';
import { installMixer, type DeckMixer, type Knob as KnobName } from '../engine/mixer';
import { SyncController } from '../engine/sync';
import { Crossfader } from './Crossfader';
import { Deck, type DeckApi } from './Deck';
import { createBoothState, DEFAULT_KNOBS } from './boothState';
import { cpmFromCps, createDeckState, type DeckId } from './deckState';
import { Knob } from './Knob';
import './booth.css';

const DECK_IDS: DeckId[] = ['A', 'B'];
const KNOBS: KnobName[] = ['lpf', 'gain', 'reverb'];
const MESSAGE_MS = 3000;

export function Booth(props: {
  library: LibraryStore;
  /** Hands the owner a getter for the mounted decks, so the library can load into them. */
  onDecks?: (decks: () => Record<DeckId, DeckApi | null>) => void;
}) {
  const booth = createBoothState();
  props.onDecks?.(() => booth.state.decks);
  const decks = { A: createDeckState('A'), B: createDeckState('B') };
  let mixer: DeckMixer | undefined;
  // Decks mount only once the mixer is installed, so no orbit is created before it reroutes them.
  const [ready, setReady] = createSignal(false);
  /** Why the engine failed to boot; the booth shows it with a Retry button. */
  const [engineError, setEngineError] = createSignal<string | null>(null);

  const startEngine = async () => {
    setEngineError(null);
    try {
      await initEngine();
      mixer = installMixer();
      setReady(true);
    } catch (e) {
      setEngineError(e instanceof Error ? e.message : String(e));
    }
  };
  onMount(() => void startEngine());

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

  const sync = new SyncController(
    () => booth.state.decks.A,
    () => booth.state.decks.B,
    setTimeout,
    { onTempoChange: (id, cps) => decks[id].setCpm(cpmFromCps(cps)) },
  );
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (message: string) => {
    clearTimeout(messageTimer);
    booth.setMessage(message);
    messageTimer = setTimeout(() => booth.setMessage(null), MESSAGE_MS);
  };
  const toggleSync = () => {
    if (sync.engaged) {
      sync.release();
      booth.setSync(false);
      return;
    }
    const result = sync.engage();
    if (result.ok) booth.setSync(true);
    else flash(result.reason);
  };
  onCleanup(() => {
    clearTimeout(messageTimer);
    // Decks clean up first (children before parents), so leave them alone here.
    sync.dispose();
  });

  // A failed load already shows in the library sidebar's error line.
  const loadDropped = (path: string, id: DeckId) => void props.library.load(path, id).catch(() => {});

  // Each deck evaluates under the eval lock in turn; a failure shows in the footer.
  const masterPlay = () =>
    void Promise.all(DECK_IDS.map((id) => booth.state.decks[id]?.evaluate(true))).catch((e) =>
      flash(`Play failed: ${e instanceof Error ? e.message : String(e)}`),
    );

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
      <aside class="booth-library" classList={{ collapsed: props.library.state.collapsed }}>
        <LibraryTree store={props.library} />
      </aside>
      <main class="booth-main">
        <Show
          when={ready()}
          fallback={
            <Show when={engineError()} fallback={<div class="booth-loading">loading engine…</div>}>
              {(err) => (
                <div class="booth-loading booth-engine-error" role="alert">
                  <p>The audio engine failed to start: {err()}</p>
                  <button class="deck-btn" onClick={() => void startEngine()}>Retry</button>
                </div>
              )}
            </Show>
          }
        >
          <div class="booth-decks">
            <For each={DECK_IDS}>
              {(id) => (
                <Deck
                  state={decks[id]}
                  onReady={(api) => booth.registerDeck(id, api)}
                  onDropPattern={(path) => loadDropped(path, id)}
                  canDropPattern={() => props.library.canDrop({ deck: true })}
                  library={props.library}
                />
              )}
            </For>
          </div>
        </Show>
        <footer class="booth-footer">
          {deckKnobs('A')}
          <Crossfader value={booth.state.fader} onChange={booth.setFader} />
          {deckKnobs('B')}
          <span class="booth-message" role="status">{booth.state.message}</span>
          <button
            class="deck-btn ghost"
            classList={{ on: booth.state.sync }}
            disabled={!ready()}
            onClick={toggleSync}
            aria-pressed={booth.state.sync}
            title="Deck B follows deck A's tempo and bar line"
          >
            Sync
          </button>
          <button class="deck-btn" disabled={!ready()} onClick={masterPlay} aria-label="play both decks">▶</button>
        </footer>
      </main>
    </div>
  );
}
