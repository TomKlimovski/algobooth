import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { Booth } from './booth/Booth';
import type { DeckApi } from './booth/Deck';
import { unpointsDecks } from './booth/deckFile';
import type { DeckId } from './booth/deckState';
import { hasTauriRuntime, tauriApi } from './library/api';
import { createLibraryStore } from './library/store';
import { RipTab } from './rip/RipTab';
import { initSettings, settings } from './settings/settings';
import { SettingsTab } from './settings/SettingsTab';
import { Tabs } from './shell/Tabs';

export function App() {
  const [tab, setTab] = createSignal('booth');
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  /** Why `ensure_library` refused the configured folder; shown as a banner linking to Settings. */
  const [libraryError, setLibraryError] = createSignal<string | null>(null);

  let boothDecks: () => Record<DeckId, DeckApi | null> = () => ({ A: null, B: null });
  const library = createLibraryStore(tauriApi, () => boothDecks());
  const refresh = () => void library.refresh().catch(() => {});
  /** The watcher's batch: refresh the tree, and let each deck reconcile its open file. */
  const onLibraryChanged = (paths: string[]) => {
    refresh();
    for (const deck of Object.values(boothDecks())) deck?.diskChanged(paths);
  };

  // Settings load here, before anything reads `library_dir` (they used to load in SettingsTab's onMount).
  onMount(async () => {
    await initSettings();
    setSettingsLoaded(true);
  });

  // Each connect bumps the generation; a slower, older connect that finishes late drops its listener.
  let generation = 0;
  let unlisten: (() => void) | undefined;
  const disconnect = () => {
    generation++;
    unlisten?.();
    unlisten = undefined;
  };
  /** Rust already follows the saved `library_dir`; this re-checks the folder and restarts the watch. */
  const connect = async () => {
    disconnect();
    const gen = generation;
    if (!hasTauriRuntime()) {
      library.setError('No Tauri runtime: the library needs the desktop app.');
      return;
    }
    try {
      await tauriApi.ensure_library();
    } catch (e) {
      if (gen === generation) {
        setLibraryError(String(e));
        library.setError('Library unavailable: see the banner above.');
      }
      return;
    }
    if (gen !== generation) return;
    setLibraryError(null);
    try {
      await tauriApi.watch_library();
      const off = await tauriApi.onLibraryChanged(onLibraryChanged);
      if (gen !== generation) return off();
      unlisten = off;
      library.setWatchWarning(null);
    } catch (e) {
      // Its own field: the refresh below (and later actions) must not clear it.
      if (gen === generation) library.setWatchWarning(`Live refresh is off: ${e}`);
    }
    if (gen === generation) refresh();
  };
  // A memo, so saving an unrelated setting (the visualiser) does not reconnect.
  const libraryDir = createMemo(() => (settingsLoaded() ? settings().library_dir : null));
  createEffect(
    on(libraryDir, (dir, prev) => {
      if (dir === null) return;
      // The decks' files are paths into the old folder: keep their code, but Save must ask where.
      if (unpointsDecks(prev, dir)) for (const deck of Object.values(boothDecks())) deck?.unpointFile();
      void connect();
    }),
  );
  onCleanup(disconnect);

  return (
    <div class="app">
      <Show when={libraryError()}>
        {(err) => (
          <div class="app-banner" role="alert">
            <span>Library folder unavailable: {err()}</span>
            <button class="deck-btn ghost" onClick={() => setTab('settings')}>Open Settings</button>
          </div>
        )}
      </Show>
      <Tabs
        active={tab()}
        onSelect={setTab}
        tabs={[
          {
            id: 'booth',
            label: 'Booth',
            view: () => (
              <Booth library={library} onDecks={(get) => (boothDecks = get)} active={() => tab() === 'booth'} />
            ),
          },
          {
            id: 'rip',
            label: 'Rip',
            view: () => (
              <RipTab
                library={library}
                decks={() => boothDecks()}
                active={() => tab() === 'rip'}
                onLoadedToDeck={() => setTab('booth')}
              />
            ),
          },
          { id: 'settings', label: 'Settings', view: () => <SettingsTab /> },
        ]}
      />
    </div>
  );
}
